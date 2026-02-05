# Dynamic Secret Injection for Cloudflare Sandbox - Research Report

## 🎯 Problem Statement

**Current Issue**: Secrets (like `CLAWDBOT_GATEWAY_TOKEN`) are passed to the Cloudflare Sandbox container at startup time and become fixed in the container's environment variables. When Worker secrets change, the container must be **completely rebuilt** to receive the new values.

**User Impact**:
- Changing a secret requires modifying Dockerfile cache bust comment
- Full container rebuild takes 3-5 minutes
- Admin page "restart gateway" only restarts the process, doesn't refresh secrets
- Operationally painful for production secret rotation

## 📊 Current Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Cloudflare Worker (Worker Runtime)                              │
│                                                                  │
│ 1. Request arrives → CF Access validates                         │
│ 2. getSandbox() → Get/create container instance                 │
│ 3. buildEnvVars(env) → Extract secrets ONCE at startup:         │
│    ├─ CLAWDBOT_GATEWAY_TOKEN                                    │
│    ├─ ANTHROPIC_API_KEY                                         │
│    └─ Other secrets                                             │
│ 4. prepareProxyRequest() → Inject token as URL param            │
│ 5. containerFetch/wsConnect() → Forward request                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ├─ Secrets passed ONCE at container startup
                       │
                       ▼
                  ┌─────────────────────────┐
                  │ Cloudflare Sandbox      │
                  │ Container (Durable)     │
                  │ ┌─────────────────────┐ │
                  │ │ Environment Vars    │ │
                  │ │ CLAWDBOT_GATEWAY... │ │ ← Fixed at startup
                  │ │ ANTHROPIC_API_KEY   │ │
                  │ └──────────┬──────────┘ │
                  │            ▼            │
                  │    ┌───────────────┐   │
                  │    │ start-moltbot │   │
                  │    │ .sh reads env │   │
                  │    └───────┬───────┘   │
                  │            ▼           │
                  │     ┌─────────────┐    │
                  │     │ Moltbot     │    │
                  │     │ Gateway     │    │
                  │     └─────────────┘    │
                  └─────────────────────────┘
```

### Key Code Locations

**1. Secret Passing at Startup** (`src/gateway/env.ts:47-49`):
```typescript
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (env.CLAWDBOT_GATEWAY_TOKEN) {
    envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN;
  }
  // Called ONCE when container starts
  // Values baked into container environment

  return envVars;
}
```

**2. Gateway Restart Endpoint** (`src/routes/api.ts:244`):
```typescript
adminApi.post('/gateway/restart', async (c) => {
  // Problem: Calls buildEnvVars with CURRENT Worker secrets
  // If Worker secrets haven't changed, container gets same values
  await ensureMoltbotGateway(c.var.sandbox, c.env);
});
```

**3. Startup Script** (`start-moltbot.sh:174-177`):
```bash
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}
# Reads environment variable ONCE at startup
```

## 🔍 Cloudflare Sandbox API Capabilities

From `@cloudflare/sandbox` v0.7.0 analysis:

| API Method | Can Pass Secrets? | When? | Dynamic? |
|-----------|------------------|-------|----------|
| `startProcess(cmd, { env })` | ✅ Yes | Process start | ❌ No |
| `containerFetch(request, port)` | ⚠️ Via headers/params | Per request | ✅ Yes |
| `wsConnect(request, port)` | ⚠️ Via headers/params | Per request | ✅ Yes |
| `exec(cmd, { env })` | ✅ Yes | One-time command | ❌ No |

**Key Finding**: ❌ **No built-in dynamic environment variable update mechanism** after process starts.

## 💡 Solution Options

### Option A: Container Requests Secrets from Worker ⭐ RECOMMENDED

**Architecture**:
```
Container Startup
    ↓
Skip reading secrets from env vars
    ↓
On first request / periodic refresh
    ↓
┌────────────────────────────────────┐
│ POST /internal/secrets             │
│ Headers:                           │
│   X-Internal-Secret: <auth-token>  │
└────────────────┬───────────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ Worker         │
        │ Validates auth │
        │ Returns:       │
        │ {              │
        │   token: "xxx" │
        │   expiresAt: T │
        │ }              │
        └────────┬───────┘
                 │
                 ▼
        Container caches
        (TTL: 12 hours)
```

**Pros**:
- ✅ Secrets never baked into container environment
- ✅ Updates immediately when Worker secrets change
- ✅ No Worker redeployment needed
- ✅ Container can refresh on-demand or periodically
- ✅ Clean separation of concerns
- ✅ Most secure option

**Cons**:
- ⚠️ Adds complexity (new API endpoint + auth)
- ⚠️ Network latency on first request (mitigated by caching)
- ⚠️ Container must handle fetch errors gracefully

**Implementation Complexity**: Medium

---

### Option B: Pass Secrets via Request Headers

**Architecture**:
```
Every Request
    ↓
Worker adds header:
  X-Gateway-Token: <token>
    ↓
Container receives request
    ↓
Gateway extracts from header
    ↓
Uses for auth/config
```

**Pros**:
- ✅ Simple implementation
- ✅ Secrets updated immediately
- ✅ No new endpoints needed
- ✅ Works for both HTTP and WebSocket

**Cons**:
- ⚠️ Secrets in request logs (security risk)
- ⚠️ Exposes secrets in request chain
- ⚠️ Header size limits
- ⚠️ Secrets visible in gateway process memory

**Implementation Complexity**: Low

---

### Option C: Use Cloudflare Durable Objects or KV

**Architecture**:
```
Worker Secret Changes
    ↓
Update KV/DO
    ↓
Container reads from KV/DO
    ↓
Caches locally
```

**Pros**:
- ✅ Persists across Worker updates
- ✅ Stronger consistency (DO) or lower latency (KV)
- ✅ Can implement audit logging

**Cons**:
- ⚠️ Requires additional bindings
- ⚠️ Additional cost
- ⚠️ More complex than Options A/B
- ⚠️ KV eventual consistency issues

**Implementation Complexity**: High

---

### Option D: Environment Variable Refresh Signal

**Not Recommended**: Requires Linux-specific mechanisms and process modification not available in Moltbot Gateway.

---

## 🎯 Recommended Approach: Hybrid (A + B)

**Primary**: Option A (Container Requests Secrets)
- Use for production
- Most secure and flexible

**Fallback**: Option B (Request Headers)
- Use if Option A endpoint unavailable
- Simpler for development/testing

### Recommended Implementation

#### Step 1: Add Internal API Endpoint

**New file**: `src/routes/internal.ts`

```typescript
import { Hono } from 'hono';
import type { AppEnv } from '../types';

const internal = new Hono<AppEnv>();

interface SecretsResponse {
  token: string;
  expiresAt: number;
  version: number;
}

/**
 * Internal endpoint for container to fetch latest secrets
 * Protected by X-Internal-Secret header
 */
internal.post('/secrets', async (c) => {
  const secret = c.req.header('X-Internal-Secret');

  // Validate against environment variable
  if (!secret || secret !== c.env.INTERNAL_API_SECRET) {
    console.error('[Internal] Unauthorized secret fetch attempt');
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const response: SecretsResponse = {
    token: c.env.CLAWDBOT_GATEWAY_TOKEN,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    version: Date.now(), // For cache invalidation
  };

  console.log('[Internal] Secrets fetched by container');
  return c.json(response);
});

export { internal };
```

**Mount in** `src/index.ts`:
```typescript
import { internal } from './routes/internal';

// After other routes
app.route('/internal', internal);
```

**Add to types** (`src/types.ts`):
```typescript
export interface MoltbotEnv {
  // ... existing properties
  INTERNAL_API_SECRET?: string; // NEW: For internal API auth
}
```

#### Step 2: Modify Container Startup Script

**Update** `start-moltbot.sh`:

```bash
# Around line 174 - REPLACE the env var reading with fetch

echo "Fetching secrets from Worker..."

# Fetch secrets from Worker internal API
# Worker is accessible at 10.1.0.1 from container
SECRETS_JSON=$(curl -X POST http://10.1.0.1:$WORKER_PORT/internal/secrets \
  -H "X-Internal-Secret: ${INTERNAL_API_SECRET}" \
  -s --max-time 5)

if [ $? -eq 0 ] && [ -n "$SECRETS_JSON" ]; then
  echo "Successfully fetched secrets from Worker"
  FETCHED_TOKEN=$(echo "$SECRETS_JSON" | jq -r '.token')

  if [ -n "$FETCHED_TOKEN" ] && [ "$FETCHED_TOKEN" != "null" ]; then
    export CLAWDBOT_GATEWAY_TOKEN="$FETCHED_TOKEN"
    echo "Using dynamically fetched gateway token"
  else
    echo "Warning: Failed to parse token from response, falling back to env var"
  fi
else
  echo "Warning: Failed to fetch secrets from Worker, using env var fallback"
  # Falls back to existing CLAWDBOT_GATEWAY_TOKEN from env
fi

# Continue with existing startup logic
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
  config.gateway.auth = config.gateway.auth || {};
  config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}
```

**Note**: Need to install `jq` in Dockerfile:
```dockerfile
RUN apt-get update && apt-get install -y jq curl
```

#### Step 3: Secret Refresh on Gateway Restart

**Update** `src/routes/api.ts` restart endpoint:

```typescript
adminApi.post('/gateway/restart', async (c) => {
  console.log('[Admin] Restarting Moltbot gateway...');

  // Force container to refetch secrets on next startup
  // by setting a marker that startup script checks
  const sandbox = c.var.sandbox;

  // Kill existing process (it will restart with fresh secret fetch)
  await killExistingProcess(sandbox);

  // Start new process (will call startup script which fetches secrets)
  await ensureMoltbotGateway(sandbox, c.env);

  console.log('[Admin] Gateway restarted with fresh secrets');

  return c.json({
    ok: true,
    message: 'Gateway restarted successfully. Secrets refreshed from Worker.',
  });
});
```

#### Step 4: Set Up New Secret

```bash
# Generate internal API secret (different from gateway token)
export INTERNAL_API_SECRET=$(openssl rand -hex 32)
echo "Internal API Secret: $INTERNAL_API_SECRET"

# Set for development
echo "$INTERNAL_API_SECRET" | npx wrangler secret put INTERNAL_API_SECRET --env development

# Set for production
echo "$INTERNAL_API_SECRET" | npx wrangler secret put INTERNAL_API_SECRET --env production
```

#### Step 5: Update Dockerfile

**Add `jq` installation**:
```dockerfile
# Line 7 - Add jq to installed packages
RUN apt-get update && apt-get install -y xz-utils ca-certificates rsync jq curl \
    && curl -fsSLk https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz \
    ...
```

**Update cache bust**:
```dockerfile
# Build cache bust: 2026-02-03-v28-dynamic-secrets
```

## 🔐 Security Considerations

### 1. Internal API Authentication

- **Mechanism**: `X-Internal-Secret` header validation
- **Secret Storage**: Wrangler secrets (encrypted at rest)
- **Secret Rotation**: Update via `wrangler secret put`
- **Minimum Length**: 32 characters (64 hex digits)

### 2. Network Isolation

- Internal API accessible only from container (10.1.0.0/24 network)
- Not exposed on public internet
- Consider adding Cloudflare Access protection for `/internal/*` routes

### 3. Logging

```typescript
// Good: Log action without sensitive data
console.log('[Internal] Secrets fetched by container');

// Bad: Never log token values
// console.log('[Internal] Token:', token); ❌
```

### 4. Rate Limiting

```typescript
// Add to internal.ts
let lastFetch = 0;
const RATE_LIMIT_MS = 60000; // 1 minute

internal.post('/secrets', async (c) => {
  const now = Date.now();
  if (now - lastFetch < RATE_LIMIT_MS) {
    return c.json({ error: 'Rate limited' }, 429);
  }
  lastFetch = now;
  // ... rest of handler
});
```

### 5. Fallback Behavior

```bash
# In startup script - graceful degradation
if secret fetch fails:
  ├─ Log warning
  ├─ Fall back to environment variable
  └─ Continue startup (don't crash)
```

## 📈 Benefits Analysis

| Aspect | Current (Static) | After Implementation (Dynamic) |
|--------|-----------------|-------------------------------|
| **Secret Update Process** | 1. Update cache bust<br>2. Redeploy Worker<br>3. Wait 3-5 min for container rebuild | 1. `wrangler secret put`<br>2. Click "Restart Gateway" in admin<br>3. Done in 10-30 sec |
| **Downtime** | 1-2 minutes | < 10 seconds |
| **Deployment Required** | Yes | No |
| **Operator Complexity** | High (must edit Dockerfile) | Low (admin UI button) |
| **Secret Rotation Frequency** | Quarterly (due to pain) | Daily/weekly (easy) |
| **Emergency Response** | Slow (rebuild required) | Fast (immediate restart) |

## 🧪 Testing Strategy

### Unit Tests

**New file**: `src/routes/internal.test.ts`

```typescript
describe('/internal/secrets', () => {
  it('should return secrets with valid auth', async () => {
    const env = createMockEnv({
      INTERNAL_API_SECRET: 'test-secret',
      CLAWDBOT_GATEWAY_TOKEN: 'gateway-token-123',
    });

    const response = await app.request('/internal/secrets', {
      method: 'POST',
      headers: { 'X-Internal-Secret': 'test-secret' },
    }, env);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.token).toBe('gateway-token-123');
    expect(json.expiresAt).toBeGreaterThan(Date.now());
  });

  it('should reject without auth header', async () => {
    const response = await app.request('/internal/secrets', {
      method: 'POST',
    }, env);

    expect(response.status).toBe(401);
  });

  it('should reject with invalid auth', async () => {
    const response = await app.request('/internal/secrets', {
      method: 'POST',
      headers: { 'X-Internal-Secret': 'wrong-secret' },
    }, env);

    expect(response.status).toBe(401);
  });
});
```

### Integration Tests

1. **Container Startup**:
   - Start container
   - Verify it makes POST request to `/internal/secrets`
   - Verify gateway starts with correct token

2. **Secret Update**:
   - Update Worker secret via `wrangler secret put`
   - Click "Restart Gateway" in admin
   - Verify new secret is fetched
   - Verify gateway uses new token

3. **Fallback Scenario**:
   - Simulate network failure (block internal API)
   - Verify container falls back to env var
   - Verify gateway starts successfully

### E2E Tests

1. **Full Flow**:
   - Change secret: `wrangler secret put CLAWDBOT_GATEWAY_TOKEN`
   - Wait 5 seconds (no rebuild)
   - Admin restart: `POST /api/admin/gateway/restart`
   - Verify: WebSocket connection succeeds with new token

2. **Error Scenarios**:
   - Missing `INTERNAL_API_SECRET` → Falls back to env var
   - Invalid auth header → Returns 401
   - Network timeout → Falls back to env var

## 📊 Performance Impact

| Metric | Impact | Mitigation |
|--------|--------|------------|
| Container startup time | +0.5-1 second | Acceptable (one-time cost) |
| Request latency | None (cached) | Fetch only at startup |
| Worker CPU | Minimal (+1 req/restart) | Insignificant |
| Cost | < $0.01/month | Negligible |

## 🚀 Migration Path

### Phase 1: Prepare (1 day)

1. ✅ Add `INTERNAL_API_SECRET` to types
2. ✅ Create `src/routes/internal.ts` with endpoint
3. ✅ Write unit tests
4. ✅ Update Dockerfile to install `jq`

### Phase 2: Implement (1 day)

1. ✅ Modify `start-moltbot.sh` with fetch logic
2. ✅ Update restart endpoint in `src/routes/api.ts`
3. ✅ Add integration tests

### Phase 3: Deploy (1 hour)

1. ✅ Set `INTERNAL_API_SECRET` secret
2. ✅ Deploy to development environment
3. ✅ Test secret update flow
4. ✅ Monitor logs for issues

### Phase 4: Production (1 hour)

1. ✅ Deploy to production
2. ✅ Document new secret rotation process
3. ✅ Update runbooks

### Phase 5: Cleanup (optional)

1. ✅ Remove Dockerfile cache bust comments (no longer needed)
2. ✅ Archive old secret rotation docs

## 📚 Documentation Updates Needed

1. **README.md**:
   - Add `INTERNAL_API_SECRET` to secrets table
   - Update secret rotation process
   - Remove Dockerfile editing instructions

2. **New file**: `docs/secret-rotation.md`
   - Step-by-step secret rotation guide
   - Using admin UI restart button
   - Emergency procedures

3. **Update**: `docs/DEPLOYMENT.md`
   - Add `INTERNAL_API_SECRET` setup
   - Explain dynamic secret fetching

## 🎉 Summary

**Problem**: Secrets fixed at container startup, requiring 3-5 minute rebuilds to update.

**Solution**: Container dynamically fetches secrets from Worker via internal API endpoint.

**Benefits**:
- ✅ **10x faster** secret updates (30 seconds vs 5 minutes)
- ✅ **No deployment** required for secret changes
- ✅ **Simpler operations** (admin UI button vs Dockerfile editing)
- ✅ **Better security** (regular rotation becomes practical)

**Implementation**:
- Complexity: Medium
- Time: 2-3 days
- Risk: Low (graceful fallback to old behavior)

**Next Steps**:
1. Review and approve approach
2. Set up `INTERNAL_API_SECRET`
3. Implement Phase 1 (internal endpoint)
4. Test in development
5. Deploy to production

---

**Recommendation**: ✅ **Proceed with implementation**

This solution solves the immediate problem (slow secret updates) while providing a foundation for future improvements (automatic rotation, secret versioning, audit logging).
