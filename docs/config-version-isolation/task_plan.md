# Task Plan: Configuration Version Isolation

## Overview
Implement configuration file version isolation using separate config files per version, with version naming based on git tags and timestamps.

## Goal
- Replace current shared config approach with version-isolated config files
- Use naming format: `clawdbot.{git_tag}_{timestamp}.json`
- Enable safe multi-version deployments and rollbacks
- Prevent config corruption between old and new code versions

## Context
Currently, all container versions share a single config file (`/root/.clawdbot/clawdbot.json`), which causes issues:
- New versions migrate config in-place, breaking old versions
- Rollbacks fail because config has been permanently modified
- Multi-instance deployments conflict on config writes

## Phases

### Phase 1: Research and Design ✅
**Status:** Complete

**Tasks:**
- [x] Understand current config loading mechanism
- [x] Identify all places that read/write config
- [x] Design version detection mechanism (git tag + timestamp)
- [x] Design config file naming scheme
- [x] Design fallback strategy (when version can't be determined)
- [x] Design migration path from current approach

**Key Decisions:**
1. Version format: `{git_tag}_{timestamp}` (e.g., v1.0.0_1738425600)
2. Version injection: Build-time via Vite define
3. Config naming: `clawdbot.{version}_{timestamp}.json`
4. No symlink for backward compatibility (user decision)
5. Fail-fast on version injection failure (user decision)
6. Manual cleanup policy (user decision)

### Phase 2: Implementation Plan ✅
**Status:** Complete

**Tasks:**
- [x] Modify build process to capture git tag + timestamp
- [x] Update start-moltbot.sh to use versioned config files
- [x] Update R2 sync to handle multiple config versions
- [x] Implement config migration for first-time version isolation
- [x] Add cleanup for old config versions (retention policy)

**Files Modified:**
1. `scripts/get-version.js` - Version detection
2. `vite.config.ts` - Build-time injection
3. `src/types.ts` - Added CONFIG_VERSION type
4. `src/index.ts` - Global declaration and middleware
5. `src/gateway/env.ts` - Pass to container
6. `start-moltbot.sh` - Use versioned configs
7. `src/gateway/sync.ts` - R2 sync updates

### Phase 3: Testing 🧪
**Status:** Pending

**Tasks:**
- [ ] Test fresh deployment (no existing config)
- [ ] Test upgrade from v1 to v2 (migration)
- [ ] Test rollback from v2 to v1
- [ ] Test multi-instance deployment
- [ ] Test R2 sync with multiple versions

### Phase 4: Documentation 📚
**Status:** Pending

**Tasks:**
- [ ] Document version naming scheme
- [ ] Document rollback procedure
- [ ] Update README with new config approach
- [ ] Add troubleshooting guide

## Current Version Detection Strategy

### Option A: Build-time Injection (Recommended)
Capture version at build time and inject into Worker environment:

```bash
# In wrangler.toml or build script
VERSION=$(git describe --tags --always)
TIMESTAMP=$(date +%s)
CONFIG_VERSION="${VERSION}_${TIMESTAMP}"
```

Pass to container via environment variable:
```typescript
env.CONFIG_VERSION = "v1.2.3_1738425600"
```

### Option B: Runtime Detection
Detect version at container startup:
```bash
# In start-moltbot.sh
VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")
TIMESTAMP=$(date +%s)
```

**Problem:** Git may not be available in container, or repo may not be mounted.

### Option C: Hardcoded Version
Manually update version in code:
```javascript
const CONFIG_VERSION = "v2.0.0";  // Update manually on each release
```

**Problem:** Easy to forget, error-prone.

## Version Naming Scheme

### Format
```
clawdbot.{git_tag}_{timestamp}.json
```

### Examples
```
clawdbot.v1.0.0_1738425600.json     # Tagged release
clawdbot.v1.0.1_1738426000.json     # Next release
clawdbot.c43689c_1738425800.json    # Untagged (commit hash)
clawdbot.dev_1738425900.json        # Development build
```

### Fallback Strategy
If git tag unavailable:
1. Use commit hash: `c43689c_1738425600`
2. If no git: `dev_1738425600`
3. If no timestamp: `unknown`

## Migration Strategy

### Step 1: Detect Existing Config
```bash
if [ -f "$CONFIG_DIR/clawdbot.json" ]; then
    # Check if it's already versioned
    if [ ! -L "$CONFIG_DIR/clawdbot.json" ]; then
        # Migrate: rename to versioned format
        LEGACY_VERSION="v1.0.0_legacy"
        mv "$CONFIG_DIR/clawdbot.json" "$CONFIG_DIR/clawdbot.${LEGACY_VERSION}.json"
        echo "Migrated legacy config to versioned format"
    fi
fi
```

### Step 2: Create Version-Specific Config
```bash
CONFIG_FILE="$CONFIG_DIR/clawdbot.${CONFIG_VERSION}.json"

# Copy from legacy if exists
if [ -f "$CONFIG_DIR/clawdbot.v1.0.0_legacy.json" ] && [ ! -f "$CONFIG_FILE" ]; then
    cp "$CONFIG_DIR/clawdbot.v1.0.0_legacy.json" "$CONFIG_FILE"
fi
```

### Step 3: Create Symlink (Optional)
```bash
# For backward compatibility
ln -sf "clawdbot.${CONFIG_VERSION}.json" "$CONFIG_DIR/clawdbot.json"
```

## R2 Sync Strategy

### Directory Structure
```
/data/moltbot/
├── configs/
│   ├── clawdbot.v1.0.0_1738425600.json
│   ├── clawdbot.v1.0.1_1738426000.json
│   └── clawdbot.v2.0.0_1738427000.json
├── .current-version                     # Tracks active version
└── skills/
    └── (skill files)
```

### Sync Logic
- Each version syncs its own config file
- Keep last N versions (e.g., 10)
- Delete configs older than retention period (e.g., 30 days)

## Rollback Procedure

### Automatic
Old version container starts:
1. Reads `CONFIG_VERSION` from environment (e.g., `v1.0.0_1738425600`)
2. Loads `clawdbot.v1.0.0_1738425600.json`
3. No migration needed, config is isolated

### Manual
```bash
# In container
cd /root/.clawdbot
ls -la clawdbot.*.json  # List available versions
ln -sf clawdbot.v1.0.0_1738425600.json clawdbot.json
# Restart gateway
```

## Open Questions

1. **Version propagation:** How does Worker pass CONFIG_VERSION to container?
   - Via environment variable? (env.CONFIG_VERSION)
   - Via file in mounted volume?
   - Via Worker metadata?

2. **Git availability:** Git is not available in the container. How to get version?
   - Must be passed from Worker (build-time)
   - Or use Worker deployment metadata

3. **Timestamp source:** Build timestamp or deploy timestamp?
   - Build: More stable, same binary = same version
   - Deploy: More accurate, but same code could have different versions

4. **Config retention:** How many old configs to keep?
   - Last 10 versions?
   - Last 30 days?
   - All versions (may consume R2 storage)?

5. **Symlink compatibility:** Should we maintain `clawdbot.json` symlink?
   - Pros: Backward compatible, easier debugging
   - Cons: May confuse version isolation

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-01 | Use git tag + timestamp for version naming | Unique, sortable, traceable to code version |
| TBD | Choose version injection method | Need to verify Worker build capabilities |
| TBD | Define config retention policy | Balance storage cost vs rollback capability |

## Next Steps

1. Verify how to inject build-time metadata into Worker
2. Test version detection in container environment
3. Implement proof-of-concept in start-moltbot.sh
4. Design Worker-side changes (if needed)
