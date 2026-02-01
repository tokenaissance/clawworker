# Findings: Configuration Version Isolation

## Current Architecture Analysis

### Config File Locations

**Container:**
```bash
/root/.clawdbot/clawdbot.json          # Main config (generated at startup)
/root/.clawdbot-templates/moltbot.json.template  # Template
/root/.clawdbot/.last-sync             # R2 sync timestamp
```

**R2 Backup:**
```bash
/data/moltbot/clawdbot/clawdbot.json   # Synced from container
/data/moltbot/.last-sync               # Sync timestamp
/data/moltbot/skills/                  # Skill files
```

### Config Loading Flow

```
start-moltbot.sh execution:
1. Check if gateway already running → exit if yes
2. Restore from R2 backup (if newer than local)
   ├─ Copy /data/moltbot/clawdbot/clawdbot.json → /root/.clawdbot/
   └─ Copy /data/moltbot/skills/ → /root/clawd/skills/
3. If no config exists, create from template
4. Update config from environment variables (Node.js block)
   ├─ Gateway token
   ├─ AI provider settings
   ├─ Channel configs (Telegram, Discord, Slack)
   └─ Model configurations
5. Write config to /root/.clawdbot/clawdbot.json
6. Start gateway process
```

### Files That Read/Write Config

**Read:**
- `start-moltbot.sh` (line 75-95): R2 restore logic
- `start-moltbot.sh` (line 109-131): Template initialization
- `start-moltbot.sh` (line 136-272): Node.js config update block
- `clawdbot gateway` binary: Reads config at startup

**Write:**
- `start-moltbot.sh` (line 311): `fs.writeFileSync(configPath, ...)`
- Worker cron job: Syncs config to R2 (src/routes/api.ts)

### Environment Variables Involved

**Passed from Worker to Container:**
```typescript
// src/gateway/env.ts
CLAWDBOT_GATEWAY_TOKEN       ← MOLTBOT_GATEWAY_TOKEN (optional)
CLAWDBOT_DEV_MODE            ← DEV_MODE
AI_GATEWAY_BASE_URL          ← AI_GATEWAY_BASE_URL
ANTHROPIC_API_KEY            ← AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN           ← TELEGRAM_BOT_TOKEN
DISCORD_BOT_TOKEN            ← DISCORD_BOT_TOKEN
SLACK_BOT_TOKEN              ← SLACK_BOT_TOKEN
SLACK_APP_TOKEN              ← SLACK_APP_TOKEN
```

**Potential New Variable:**
```
CONFIG_VERSION               ← To be added
```

### Worker Build Process

**Current:**
```bash
npm run build        # Build client and worker
npm run deploy       # wrangler deploy
```

**Build Output:**
- `dist/clawbot_sandbox/`: Worker bundle
- `dist/client/`: Frontend assets
- No version injection currently

**wrangler.toml:**
```toml
name = "clawbot-sandbox"
main = "dist/clawbot_sandbox/index.js"
compatibility_date = "2024-01-01"

[env.production]
name = "clawbot-sandbox"
```

No version variables defined.

## Version Detection Research

### Option 1: Build-time Injection via wrangler.toml

**Method:**
Add vars to wrangler.toml dynamically:

```toml
[vars]
CONFIG_VERSION = "v1.0.0_1738425600"
```

**Problem:** wrangler.toml is static, can't execute shell commands.

**Solution:** Generate wrangler.toml dynamically or use build script.

### Option 2: Environment Variable at Deploy Time

**Method:**
```bash
# In package.json deploy script
VERSION=$(git describe --tags --always)
TIMESTAMP=$(date +%s)
wrangler deploy --var CONFIG_VERSION="${VERSION}_${TIMESTAMP}"
```

**Problem:** `--var` flag doesn't exist in wrangler.

**Solution:** Use `wrangler secret put` or modify worker code.

### Option 3: Inject into Worker Code

**Method:**
Use esbuild define during build:

```javascript
// In build script
import { build } from 'esbuild';

const version = execSync('git describe --tags --always').toString().trim();
const timestamp = Math.floor(Date.now() / 1000);

build({
  define: {
    '__CONFIG_VERSION__': `"${version}_${timestamp}"`,
  },
  // ... other config
});
```

**In Worker code:**
```typescript
declare const __CONFIG_VERSION__: string;

export default {
  async fetch(request: Request, env: MoltbotEnv) {
    // Pass to container
    env.CONFIG_VERSION = __CONFIG_VERSION__;
  }
}
```

**Status:** Most promising, needs verification.

### Option 4: Use Worker Metadata

**Method:**
Cloudflare Workers have deployment metadata:

```typescript
// Check if available
console.log('CF metadata:', request.cf);
```

**Problem:** Metadata doesn't include git version, only CF deployment info.

### Option 5: Read from package.json

**Method:**
Store version in package.json, inject at build time:

```json
{
  "name": "clawbot-sandbox",
  "version": "1.0.0"
}
```

```javascript
import pkg from './package.json';
const version = pkg.version;
```

**Problem:** Need to manually update package.json on each release.

## Git Tag Research

### Current Repository State

```bash
$ git tag | wc -l
0
```

No tags exist in repository.

### Creating First Tag

```bash
# Create annotated tag
git tag -a v1.0.0 -m "Initial version for config isolation"

# Push to remote
git push origin v1.0.0
```

### Tag Naming Convention

**Recommended:** Semantic Versioning
```
v{MAJOR}.{MINOR}.{PATCH}

Examples:
v1.0.0  - Initial release
v1.1.0  - Minor feature (config version isolation)
v1.1.1  - Bug fix
v2.0.0  - Breaking change
```

### Getting Version in Different Scenarios

**With tag:**
```bash
git describe --tags --always
# Output: v1.0.0
```

**After commits past tag:**
```bash
git describe --tags --always
# Output: v1.0.0-3-gc43689c
# Meaning: 3 commits after v1.0.0, current commit c43689c
```

**No tags:**
```bash
git describe --tags --always
# Output: c43689c (commit hash)
```

**Simplified version (tag or commit):**
```bash
git describe --tags --always --abbrev=0 2>/dev/null || git rev-parse --short HEAD
# Output: v1.0.0 or c43689c
```

## Timestamp Research

### Unix Timestamp
```bash
date +%s
# Output: 1738425600
```

### ISO 8601 Format (Alternative)
```bash
date -u +"%Y%m%dT%H%M%SZ"
# Output: 20260201T120000Z
```

**Comparison:**

| Format | Example | Pros | Cons |
|--------|---------|------|------|
| Unix | `1738425600` | Short, sortable | Not human-readable |
| ISO 8601 | `20260201T120000Z` | Human-readable, sortable | Longer |

**Recommendation:** Unix timestamp (shorter, standard).

## R2 Sync Investigation

### Current Sync Mechanism

**File:** [src/routes/api.ts:306-359](src/routes/api.ts:306-359)

```typescript
// Cron-triggered sync
app.get('/api/cron/sync', async (c) => {
  // 1. Get sandbox instance
  // 2. Sync config from container to R2
  // 3. Update .last-sync timestamp
});
```

**Sync Direction:** Container → R2 (one-way backup)

**Files Synced:**
- `/root/.clawdbot/` → `/data/moltbot/clawdbot/`
- `/root/clawd/skills/` → `/data/moltbot/skills/`

### Multi-Version Sync Strategy

**Option A: Separate Sync Per Version**

Each version syncs to its own path:
```
/data/moltbot/
├── configs/
│   ├── v1.0.0_1738425600/
│   │   ├── clawdbot.json
│   │   └── .last-sync
│   └── v1.1.0_1738426000/
│       ├── clawdbot.json
│       └── .last-sync
└── skills/  (shared)
```

**Option B: Versioned Filename**

```
/data/moltbot/clawdbot/
├── clawdbot.v1.0.0_1738425600.json
├── clawdbot.v1.1.0_1738426000.json
└── .last-sync-{version}
```

**Recommendation:** Option B (simpler, less directory nesting).

## Container Environment Research

### How CONFIG_VERSION Gets to Container

**Current Flow:**
```
Worker Secrets
    ↓ (via env binding)
Worker Environment (MoltbotEnv)
    ↓ (buildEnvVars() in src/gateway/env.ts)
Container Environment Variables
    ↓ (process.env in start-moltbot.sh)
Startup Script
```

**Adding CONFIG_VERSION:**

**Option 1:** Via Worker vars (build-time)
```typescript
// src/gateway/env.ts
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Add config version
  if (env.CONFIG_VERSION) {
    envVars.CONFIG_VERSION = env.CONFIG_VERSION;
  }

  // ... rest
}
```

**Option 2:** Generate in Worker at runtime
```typescript
// src/index.ts
const CONFIG_VERSION = `${GIT_VERSION}_${Date.now()}`;
env.CONFIG_VERSION = CONFIG_VERSION;
```

**Problem:** Date.now() changes on every request (not stable).

**Option 3:** Store in Worker metadata (deployment-level)
```bash
wrangler deploy --define CONFIG_VERSION="v1.0.0_1738425600"
```

## Code Changes Required

### Files to Modify

1. **Build Script (new file):** `scripts/inject-version.js`
   - Read git tag
   - Get timestamp
   - Inject into Worker bundle

2. **Worker Entry:** `src/index.ts`
   - Expose CONFIG_VERSION to environment

3. **Environment Builder:** `src/gateway/env.ts`
   - Pass CONFIG_VERSION to container

4. **Startup Script:** `start-moltbot.sh`
   - Use CONFIG_VERSION for config filename
   - Handle migration from legacy config

5. **R2 Sync:** `src/routes/api.ts`
   - Sync versioned config files
   - Implement retention policy

6. **Package.json:** `package.json`
   - Update build command to run version injection

### Estimated Complexity

| Component | Complexity | Risk | Time Estimate |
|-----------|------------|------|---------------|
| Version injection | Medium | Low | 1-2 hours |
| Worker changes | Low | Low | 30 min |
| Env builder | Low | Low | 15 min |
| Startup script | High | Medium | 2-3 hours |
| R2 sync | Medium | Medium | 1-2 hours |
| Testing | High | High | 3-4 hours |
| **Total** | **Medium** | **Medium** | **8-12 hours** |

## Risks and Mitigation

### Risk 1: Version Injection Fails
**Impact:** Config falls back to "unknown" version, loses isolation.

**Mitigation:**
- Default to commit hash if no tag
- Log warning when version is unknown
- Fail deployment if version injection fails

### Risk 2: Config Migration Fails
**Impact:** Users lose existing config.

**Mitigation:**
- Create backup before migration
- Log all migration steps
- Provide manual rollback procedure

### Risk 3: R2 Storage Bloat
**Impact:** Excessive storage costs from keeping all config versions.

**Mitigation:**
- Implement retention policy (keep last 10 versions)
- Add cleanup cron job
- Monitor R2 storage usage

### Risk 4: Multi-Instance Race Condition
**Impact:** Multiple containers sync different versions simultaneously.

**Mitigation:**
- Each version writes to separate file
- No conflict if versions are different
- If same version: last write wins (acceptable)

## Alternative Approaches Considered

### Approach A: Content-Addressable Config
Use hash of config content as filename:
```
clawdbot.sha256-a1b2c3d4.json
```

**Pros:** Deduplication, cache-friendly.
**Cons:** Can't tell version from filename, hard to debug.
**Verdict:** ❌ Rejected (poor DX).

### Approach B: Database-backed Config
Store config in KV or D1 instead of JSON files:
```
KV.get(`config:${version}`)
```

**Pros:** Atomic updates, no file sync.
**Cons:** Requires significant refactoring, clawdbot expects JSON file.
**Verdict:** ❌ Rejected (too invasive).

### Approach C: Immutable Config + Patches
Store base config + version-specific patches:
```
clawdbot.base.json
clawdbot.v1.0.0.patch.json
```

**Pros:** Less duplication.
**Cons:** Complex merge logic, harder to debug.
**Verdict:** ❌ Rejected (over-engineered).

### Approach D: Version-Isolated Config (SELECTED)
Separate file per version:
```
clawdbot.v1.0.0_1738425600.json
```

**Pros:** Simple, debuggable, safe isolation.
**Cons:** Some duplication, need retention policy.
**Verdict:** ✅ **Selected**.

## References

- Current config loading: [start-moltbot.sh:75-131](start-moltbot.sh:75-131)
- Config update logic: [start-moltbot.sh:136-272](start-moltbot.sh:136-272)
- Environment builder: [src/gateway/env.ts:18-52](src/gateway/env.ts:18-52)
- R2 sync: [src/routes/api.ts:306-359](src/routes/api.ts:306-359)
- Git versioning discussion: Previous conversation about container parameter versioning
