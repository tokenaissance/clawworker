# Task Plan: Configure Gateway Token in Worker Environment

## Goal
Set CLAWDBOT_GATEWAY_TOKEN as a Worker environment variable (hardcoded in code), and pass it to the container when starting gateway. Users don't need to manually set secrets.

## Current Situation
- Gateway requires authentication when binding to LAN mode
- Currently expects users to manually set CLAWDBOT_GATEWAY_TOKEN secret
- If secret is not set, gateway fails to start with: "Refusing to bind gateway to lan without auth"

## Proposed Solution
1. Hardcode CLAWDBOT_GATEWAY_TOKEN in Worker code (src/gateway/env.ts or src/index.ts)
2. Pass it to container via buildEnvVars()
3. Container startup script reads it and passes --token to gateway
4. Token is managed in code, not requiring manual secret setup

## Phases

### Phase 1: Design Decision ✅
**Status:** Completed

**Decided approach:**
- Store default token as constant in Worker code
- Use existing buildEnvVars() mechanism to pass to container
- Allow override via Cloudflare secret (backward compatible)

**Implementation location:**
- Define token constant in src/gateway/env.ts
- Modify buildEnvVars() to include default token
- Container startup script already handles CLAWDBOT_GATEWAY_TOKEN

### Phase 2: Implementation ⏳
**Status:** In Progress

**Tasks:**
- [ ] Add DEFAULT_GATEWAY_TOKEN constant in src/gateway/env.ts
- [ ] Modify buildEnvVars() to set CLAWDBOT_GATEWAY_TOKEN with fallback
- [ ] Keep start-moltbot.sh logic unchanged (already handles the env var)
- [ ] Test gateway starts successfully

**Code changes needed:**

```typescript
// src/gateway/env.ts
const DEFAULT_GATEWAY_TOKEN = 'clawbot-internal-gateway-auth-v1';

export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Gateway token: use secret if provided, otherwise use default
  envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN || DEFAULT_GATEWAY_TOKEN;

  // ... rest of env vars
  return envVars;
}
```

### Phase 3: Testing ⏸️
**Status:** Pending

**Tasks:**
- [ ] Remove CLAWDBOT_GATEWAY_TOKEN secret (if exists)
- [ ] Deploy Worker with hardcoded token
- [ ] Verify gateway starts with default token
- [ ] Test WebSocket connections work
- [ ] Verify override still works (set secret and test)

### Phase 4: Deployment ⏸️
**Status:** Pending

**Tasks:**
- [ ] Commit changes
- [ ] Tag new version (v1.2.0 or v1.1.1)
- [ ] Deploy to production
- [ ] Verify gateway starts successfully
- [ ] Update documentation

## Open Questions
1. Is it acceptable to have the token visible in source code and Docker image?
2. Should we still allow CLAWDBOT_GATEWAY_TOKEN to override the hardcoded value?
3. What token value to use? Random? Fixed? Generated?

## Dependencies
- Docker deployment must succeed (current blocker: network issues)
- R2 config cleanup may be needed

## Notes
- This removes the requirement for users to manually set secrets
- Simplifies deployment process
- Trade-off: token is no longer secret (visible in code/image)
