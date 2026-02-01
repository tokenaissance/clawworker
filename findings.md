# Findings: Gateway Token Configuration

## Current Implementation Analysis

### Gateway Startup Logic (start-moltbot.sh lines 321-329)

```bash
BIND_MODE="localhost"  # Changed from "lan"
echo "Dev mode: ${CLAWDBOT_DEV_MODE:-false}, Bind mode: $BIND_MODE"

if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
```

**Key findings:**
1. Currently checks if `CLAWDBOT_GATEWAY_TOKEN` environment variable is set
2. If set, passes `--token` to gateway
3. If not set, attempts to start without token (device pairing mode)
4. In LAN mode, gateway refuses to start without auth
5. In localhost mode, gateway may allow no-auth startup

### Gateway Auth Requirements

**From clawdbot binary (compiled Rust code):**
- Error: "Refusing to bind gateway to lan without auth"
- This is hardcoded in the clawdbot/openclaw binary
- Cannot be bypassed without recompiling

**Bind modes:**
- `lan`: Binds to 0.0.0.0, accessible from network, **requires auth**
- `localhost`: Binds to 127.0.0.1, local only, **may allow no-auth**

### Token Security Model

**Current (user-provided secret):**
- ✅ Token is secret (only in Cloudflare secrets)
- ✅ Not visible in code or image
- ❌ Requires manual setup by users
- ❌ Extra deployment step

**Proposed (hardcoded token):**
- ✅ No manual setup needed
- ✅ Simpler deployment
- ❌ Token visible in source code
- ❌ Token visible in Docker image
- ⚠️ Anyone with image access can see token

### Security Considerations

**Who can access the gateway?**
1. Only code running in the same Cloudflare Sandbox container
2. Gateway binds to localhost:18789 (not exposed externally)
3. Worker accesses via local network stack
4. No external network access to gateway port

**Threat model:**
- ✅ External attackers cannot reach gateway (localhost bind)
- ✅ Other Cloudflare customers cannot access (sandbox isolation)
- ⚠️ Anyone with Docker image can extract token
- ⚠️ Anyone with source code access can see token

**Is this acceptable?**
- Gateway is already isolated to container
- Token mainly authenticates Worker → Gateway communication
- No external exposure regardless of token
- **Conclusion: Hardcoded token is reasonably secure for this use case**

## Implementation: Worker Environment Variable Approach

### Architecture

```
Worker (src/gateway/env.ts)
  ↓
  DEFAULT_GATEWAY_TOKEN constant
  ↓
  buildEnvVars() sets CLAWDBOT_GATEWAY_TOKEN
  ↓
Container environment variables
  ↓
start-moltbot.sh reads CLAWDBOT_GATEWAY_TOKEN
  ↓
Gateway starts with --token
```

### Implementation Details

**File: src/gateway/env.ts**

Current code already has buildEnvVars() function that passes env vars to container:

```typescript
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Config version for config file isolation
  if (env.CONFIG_VERSION) {
    envVars.CONFIG_VERSION = env.CONFIG_VERSION;
  }

  // Other env vars...

  return envVars;
}
```

**Proposed change:**

```typescript
// Add at top of file
const DEFAULT_GATEWAY_TOKEN = 'clawbot-internal-gateway-auth-v1';

export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Config version for config file isolation
  if (env.CONFIG_VERSION) {
    envVars.CONFIG_VERSION = env.CONFIG_VERSION;
  }

  // Gateway token: use secret if set, otherwise use default
  // This allows users to override with a custom secret, but provides
  // a working default so manual secret setup is not required
  envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN || DEFAULT_GATEWAY_TOKEN;

  // Other env vars...

  return envVars;
}
```

**File: start-moltbot.sh (NO CHANGES NEEDED)**

Current code already handles CLAWDBOT_GATEWAY_TOKEN:

```bash
if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token auth..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    echo "Starting gateway with device pairing (no token)..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE"
fi
```

This will now always use token since CLAWDBOT_GATEWAY_TOKEN will always be set by Worker.

### Benefits of This Approach

1. **Centralized Configuration**
   - Token defined in Worker code (src/gateway/env.ts)
   - Single source of truth
   - Easy to update and version control

2. **Backward Compatible**
   - Still respects CLAWDBOT_GATEWAY_TOKEN secret if users set it
   - Graceful fallback to default
   - No breaking changes

3. **No Container Changes**
   - Reuses existing buildEnvVars() mechanism
   - start-moltbot.sh unchanged
   - Minimal code changes

4. **Proper Layering**
   - Worker layer: configuration
   - Container layer: execution
   - Clear separation of concerns

5. **Easy Testing**
   - Can override in development
   - Can test with/without secret
   - Predictable behavior

### Security Implications

**Token Visibility:**
- ✅ Token in Worker source code (acceptable - Worker is our code)
- ✅ Token passed as env var to container (internal communication)
- ✅ Gateway binds to localhost (no external exposure)
- ✅ Container isolated by Cloudflare Sandbox

**Attack Surface:**
- External attackers: Cannot reach gateway (localhost bind)
- Other Cloudflare customers: Cannot access container (isolation)
- Source code access: Can see token but cannot exploit (no external gateway access)

**Conclusion:** This approach is secure given the architecture.

### Alternative Considered: Build-Time Injection

We could inject token at build time via Vite define, but Worker env var approach is simpler:

```typescript
// Alternative (more complex, not recommended)
declare const __GATEWAY_TOKEN__: string;
envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN || __GATEWAY_TOKEN__;
```

**Why Worker env var is better:**
- Simpler implementation
- Runtime flexibility
- No build-time magic
- Easier to understand
