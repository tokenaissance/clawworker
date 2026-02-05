# Authentication Architecture

This document explains the three-layer security model used in the OpenClaw deployment and why the browser never needs to know the gateway token.

## Overview

```
Browser ──WSS/HTTP──→ Worker ──(auto-inject token)──→ Docker Gateway
              ↑                                            ↑
        CF Access Auth                               Token Validation
       (User Identity)                              (Source Verification)
```

**Key Point: The browser never connects directly to Docker. All connections are proxied through the Worker.**

## Three-Layer Security Model

| Layer | Location | Purpose | Validates |
|-------|----------|---------|-----------|
| Layer 1 | Worker | CF Access | User identity (Who are you?) |
| Layer 2 | Docker | Gateway Token | Request source (Are you from Worker?) |
| Layer 3 | Gateway | Device Pairing | Device authorization (Is this device approved?) |

### Layer 1: Cloudflare Access (User Authentication)

**Location:** `src/auth/middleware.ts`

Cloudflare Access provides user authentication at the edge:

- Users authenticate via Cloudflare's login page (supports SSO, email OTP, etc.)
- Worker receives a signed JWT (`CF-Access-JWT-Assertion` header or `CF_Authorization` cookie)
- Worker verifies the JWT signature against Cloudflare's public keys
- User identity (email, name) is extracted and made available to the application

```typescript
// src/auth/middleware.ts:41-125
export function createAccessMiddleware(options: AccessMiddlewareOptions) {
  return async (c: Context<AppEnv>, next: Next) => {
    // Skip auth in dev mode
    if (isDevMode(c.env)) {
      c.set('accessUser', { email: 'dev@localhost', name: 'Dev User' });
      return next();
    }

    // Verify JWT from CF Access
    const jwt = extractJWT(c);
    const payload = await verifyAccessJWT(jwt, teamDomain, expectedAud);
    c.set('accessUser', { email: payload.email, name: payload.name });
    // ...
  };
}
```

### Layer 2: Gateway Token (Source Verification)

**Location:** `src/gateway/injection.ts`

The gateway token is an internal secret shared between Worker and Docker:

- Browser requests arrive at Worker **without** the token
- Worker automatically injects the token before proxying to Docker
- Docker validates the token to ensure requests come from the authorized Worker
- Token is never exposed to the browser

```typescript
// src/gateway/injection.ts:273-317
export function prepareProxyRequest(config: ProxyRequestConfig): ProxyRequestResult {
  const { request, env, injectionConfig = DEFAULT_GATEWAY_CONFIG } = config;

  // Inject token into URL parameters
  const injectionResult = injectUrlParameters(url, env, injectionConfig);

  // Create modified request with token
  const modifiedRequest = new Request(injectionResult.url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  return { request: modifiedRequest, /* ... */ };
}
```

The token is also passed to the container process via environment variables:

```typescript
// src/gateway/env.ts:47-49
if (env.CLAWDBOT_GATEWAY_TOKEN) {
  envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN;
}
```

### Layer 3: Device Pairing (Device Authorization)

**Location:** Docker Gateway (moltbot)

Device pairing provides per-device authorization:

- Each device must be explicitly paired before it can interact with the bot
- Pairing is done via a secure flow (e.g., admin approval, pairing code)
- Prevents unauthorized devices from using the bot even if they have network access

See [device-pairing.md](device-pairing.md) for detailed documentation.

## Why This Design is Secure

### 1. Defense in Depth

Multiple independent security layers mean an attacker must compromise all layers:

- Compromising CF Access alone doesn't give access to Docker (no token)
- Stealing the token alone doesn't work (CF Access blocks unauthenticated requests)
- Even with both, device pairing provides another barrier

### 2. Token Never Exposed to Client

The browser only needs CF Access authentication:

- Token is a "server-to-server" secret
- Even if the browser is compromised (XSS, malicious extension), the token cannot be stolen
- Token injection happens server-side in the Worker

### 3. Clear Separation of Concerns

| Component | Responsibility |
|-----------|----------------|
| Cloudflare Access | User identity management |
| Worker | Request proxying, token injection, error transformation |
| Docker Gateway | Business logic, AI agent execution |

### 4. Minimal Attack Surface

- Docker is not directly exposed to the internet
- All traffic goes through Cloudflare's edge network
- Worker can implement rate limiting, logging, and other protections

## Request Flow

### HTTP Request

```
1. Browser → Worker: GET /api/status
   Headers: CF-Access-JWT-Assertion: <jwt>

2. Worker validates CF Access JWT

3. Worker → Docker: GET /api/status?token=<gateway_token>
   (token injected by prepareProxyRequest)

4. Docker validates token, processes request

5. Docker → Worker → Browser: Response
```

### WebSocket Connection

```
1. Browser → Worker: WSS upgrade request
   Headers: CF-Access-JWT-Assertion: <jwt>

2. Worker validates CF Access JWT

3. Worker → Docker: WSS upgrade with ?token=<gateway_token>
   (token injected by prepareProxyRequest)

4. Docker validates token, accepts WebSocket

5. Worker creates WebSocket pair, relays messages bidirectionally
   - Client ↔ Worker ↔ Docker
   - Error messages are transformed before reaching client
```

## Code References

| Functionality | File | Key Code |
|---------------|------|----------|
| Token injection | `src/gateway/injection.ts:273-317` | `prepareProxyRequest()` |
| WSS proxy | `src/index.ts:271-390` | WebSocket interception and relay |
| CF Access verification | `src/auth/middleware.ts:41-125` | `createAccessMiddleware()` |
| Token passed to container | `src/gateway/env.ts:47-49` | `buildEnvVars()` |
| Default token config | `src/gateway/injection.ts:137-145` | `DEFAULT_GATEWAY_CONFIG` |

## Security Checklist

- [ ] `CLAWDBOT_GATEWAY_TOKEN` is set and kept secret
- [ ] CF Access is configured for protected routes
- [ ] `DEV_MODE` is NOT set in production
- [ ] Device pairing is enabled (default `pairing` DM policy)
- [ ] Worker logs do not expose the token (URL parameters are logged without token value)

## Potential Improvements

### Token Transmission Method

Currently, the token is passed via URL query parameter (`?token=xxx`). While functional, this has a minor concern:

- URL parameters may be logged by intermediate systems
- Consider migrating to `Authorization` header in the future

However, since all traffic is internal (Worker → Docker over Cloudflare's network), this is low risk.

### Error Message Transformation

The Worker already transforms error messages via `transformErrorMessage()` to provide user-friendly errors. This can be extended as needed.

## FAQ

### Q: Why doesn't the browser need the gateway token?

The browser authenticates via CF Access (Layer 1). The gateway token (Layer 2) is for Worker-to-Docker authentication. Since the browser never talks directly to Docker, it doesn't need the token.

### Q: What if someone bypasses the Worker and connects directly to Docker?

Docker is not exposed to the public internet. It only accepts connections from the Worker. Even if someone could reach Docker directly, they would need the gateway token to authenticate.

### Q: Is it safe to pass the token in URL parameters?

For internal Worker-to-Docker communication over Cloudflare's network, this is acceptable. The token is never exposed to the browser or logged in client-accessible logs. For additional security, consider migrating to Authorization headers.

### Q: What happens if CF Access is misconfigured?

The Worker checks for CF Access configuration and returns an error if not properly set up. In dev mode (`DEV_MODE=true`), authentication is bypassed for local development only.
