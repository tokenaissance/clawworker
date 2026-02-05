# R2 Bucket Mount Path Environment Isolation

## Overview

This document describes the R2 bucket mount path environment isolation implementation, which ensures complete data separation between development and production environments.

## Problem Statement

### Before Implementation

Prior to this implementation, both development and production environments mounted their R2 buckets to the same path inside the container:

```
Development:  moltbot-data-development → /data/moltbot
Production:   moltbot-data-production  → /data/moltbot
```

This caused several issues:

1. **Shared Mount Path** - Both environments used `/data/moltbot`, which could cause conflicts if containers ran simultaneously
2. **"Directory Not Empty" Errors** - When switching between environments, the mount directory could already exist with data from a different bucket
3. **No Clear Separation** - The mount path didn't indicate which environment was running
4. **Potential Data Leakage** - Risk of cross-environment contamination

### After Implementation

With the new implementation, each environment has its own isolated mount path:

```
Development:  moltbot-data-development → /data/moltbot-development
Production:   moltbot-data-production  → /data/moltbot-production
Legacy/None:  moltbot-data            → /data/moltbot
```

## Architecture

### Dynamic Mount Path Resolution

The mount path is now determined dynamically based on the `ENVIRONMENT` variable:

```typescript
// src/config.ts
export function getR2MountPath(environment?: string): string {
  if (!environment) {
    return '/data/moltbot';  // Backward compatibility
  }
  return `/data/moltbot-${environment}`;
}
```

### Complete Data Flow (Read/Write Isolation)

The system now has complete end-to-end environment isolation across all data operations:

```
┌─────────────────────────────────────────────────────────────┐
│ Worker Environment (wrangler.jsonc)                          │
│ ENVIRONMENT="development" or "production"                    │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ├─> Mount R2 Bucket
                      │   ├─ getR2BucketName(env.ENVIRONMENT)
                      │   │  → "moltbot-data-development"
                      │   └─ getR2MountPath(env.ENVIRONMENT)
                      │      → "/data/moltbot-development"
                      │
                      ├─> Write Data (Backup Sync)
                      │   └─ rsync to ${getR2MountPath()}/
                      │      → "/data/moltbot-development/clawdbot/"
                      │
                      └─> Read Data (Restore on Startup)
                          └─ Container receives ENVIRONMENT variable
                             └─ BACKUP_DIR="/data/moltbot-$ENVIRONMENT"
                                → "/data/moltbot-development/"
```

**Key Points:**

1. **Single Source of Truth:** The `ENVIRONMENT` variable from `wrangler.jsonc` drives all path decisions
2. **TypeScript Layer:** Uses `getR2MountPath(env.ENVIRONMENT)` for mount and write operations
3. **Container Layer:** Receives `ENVIRONMENT` variable and constructs matching path for read operations
4. **Consistency:** All three operations (mount, write, read) use identical paths

### Environment Variable Flow

```
wrangler.jsonc
  vars: { ENVIRONMENT: "development" }
        ↓
c.env.ENVIRONMENT (Worker context)
        ↓
buildEnvVars(env) → envVars.ENVIRONMENT (Phase 2 fix)
        ↓
Container Process Environment
        ↓
start-moltbot.sh: $ENVIRONMENT (Phase 2 fix)
        ↓
BACKUP_DIR="/data/moltbot-$ENVIRONMENT"
```

### Environment-Specific Naming Convention

The naming follows a consistent pattern across all environment-specific resources:

| Resource Type | Development | Production | Default |
|--------------|-------------|------------|---------|
| Bucket Name | `moltbot-data-development` | `moltbot-data-production` | `moltbot-data` |
| Mount Path | `/data/moltbot-development` | `/data/moltbot-production` | `/data/moltbot` |

## Implementation Details

### Phase 1: Write Path Isolation (Initial Implementation)

The initial implementation focused on isolating R2 write paths, ensuring that data written to R2 used environment-specific paths.

### Phase 2: Read Path Isolation (Cache Restore Fix)

A subsequent fix addressed a critical issue where the container startup script used hardcoded read paths, preventing proper data restoration from environment-specific R2 buckets.

### Modified Files

#### 1. `src/config.ts`

**Changes:**
- Removed hardcoded `R2_MOUNT_PATH` constant
- Added `getR2MountPath(environment?: string)` function
- Mirrors the existing `getR2BucketName()` pattern

**Code:**
```typescript
/**
 * Get R2 mount path based on environment
 * @param environment - Environment name from ENVIRONMENT variable
 * @returns Mount path (e.g., "/data/moltbot-production", "/data/moltbot-development")
 */
export function getR2MountPath(environment?: string): string {
  if (!environment) {
    return '/data/moltbot';
  }
  return `/data/moltbot-${environment}`;
}
```

#### 2. `src/gateway/r2.ts`

**Changes:**
- Updated imports to use `getR2MountPath`
- Modified `isR2Mounted()` to accept `mountPath` parameter
- Updated `mountR2Storage()` to use dynamic mount path

**Before:**
```typescript
import { R2_MOUNT_PATH, getR2BucketName } from '../config';

async function isR2Mounted(sandbox: Sandbox): Promise<boolean> {
  const proc = await sandbox.startProcess(`mount | grep "s3fs on ${R2_MOUNT_PATH}"`);
  // ...
}

export async function mountR2Storage(sandbox: Sandbox, env: MoltbotEnv) {
  const bucketName = getR2BucketName(env.ENVIRONMENT);
  await sandbox.mountBucket(bucketName, R2_MOUNT_PATH, { ... });
}
```

**After:**
```typescript
import { getR2BucketName, getR2MountPath } from '../config';

async function isR2Mounted(sandbox: Sandbox, mountPath: string): Promise<boolean> {
  const proc = await sandbox.startProcess(`mount | grep "s3fs on ${mountPath}"`);
  // ...
}

export async function mountR2Storage(sandbox: Sandbox, env: MoltbotEnv) {
  const bucketName = getR2BucketName(env.ENVIRONMENT);
  const mountPath = getR2MountPath(env.ENVIRONMENT);
  await sandbox.mountBucket(bucketName, mountPath, { ... });
}
```

#### 3. `src/gateway/sync.ts`

**Changes:**
- Updated imports to use `getR2MountPath`
- Modified `syncToR2()` to use environment-specific mount path

**Key Change:**
```typescript
export async function syncToR2(sandbox: Sandbox, env: MoltbotEnv) {
  const mountPath = getR2MountPath(env.ENVIRONMENT);

  const syncCmd = `rsync -r --no-times --delete \
    /root/.clawdbot/ ${mountPath}/clawdbot/ && \
    rsync -r --no-times --delete \
    /root/clawd/skills/ ${mountPath}/skills/ && \
    date -Iseconds > ${mountPath}/.last-sync`;

  // ...
}
```

#### 4. `src/routes/api.ts`

**Changes:**
- Updated imports to use `getR2MountPath`
- Modified `/api/admin/storage` endpoint to check correct mount path

**Key Change:**
```typescript
adminApi.get('/storage', async (c) => {
  if (hasCredentials) {
    await mountR2Storage(sandbox, c.env);
    const mountPath = getR2MountPath(c.env.ENVIRONMENT);
    const proc = await sandbox.startProcess(`cat ${mountPath}/.last-sync 2>/dev/null || echo ""`);
    // ...
  }
});
```

#### 5. `src/gateway/r2.test.ts`

**Changes:**
- Updated test expectations to verify environment-specific mount paths
- Added explicit tests for default, development, and production environments

**Test Cases:**
```typescript
it('uses default mount path when ENVIRONMENT is not set', async () => {
  // Expects: '/data/moltbot'
});

it('uses environment-specific mount path when ENVIRONMENT is production', async () => {
  // Expects: '/data/moltbot-production'
});

it('uses development mount path when ENVIRONMENT is development', async () => {
  // Expects: '/data/moltbot-development'
});
```

#### 6. `src/gateway/env.ts` (Phase 2: Read Path Fix)

**Problem:** The `ENVIRONMENT` variable was not being passed to the container, so the startup script couldn't determine which R2 mount path to read from.

**Changes:**
- Added `ENVIRONMENT` to the environment variables passed to the container process

**Code:**
```typescript
export function buildEnvVars(env: MoltbotEnv): Record<string, string> {
  const envVars: Record<string, string> = {};

  // ... other environment variables ...

  // Environment name (for R2 path isolation)
  if (env.ENVIRONMENT) {
    envVars.ENVIRONMENT = env.ENVIRONMENT;
  }

  return envVars;
}
```

#### 7. `start-moltbot.sh` (Phase 2: Read Path Fix)

**Problem:** The container startup script hardcoded the backup directory path as `/data/moltbot`, which prevented data restoration from environment-specific R2 mount paths like `/data/moltbot-development` or `/data/moltbot-production`.

**Impact:**
- R2 would mount correctly at environment-specific paths
- Container startup would look for backups at the wrong path
- Data restore would fail silently with message: "R2 not mounted, starting fresh"
- Paired devices and conversation history would be lost on restart

**Changes:**
- Made `BACKUP_DIR` dynamic based on the `$ENVIRONMENT` variable
- Added descriptive logging to show which path is being used
- Maintained backward compatibility (falls back to `/data/moltbot` if no ENVIRONMENT set)

**Before:**
```bash
# Paths (clawdbot paths are used internally - upstream hasn't renamed yet)
CONFIG_DIR="/root/.clawdbot"
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
TEMPLATE_DIR="/root/.clawdbot-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/moltbot.json.template"
BACKUP_DIR="/data/moltbot"  # ❌ HARDCODED

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"
```

**After:**
```bash
# Paths (clawdbot paths are used internally - upstream hasn't renamed yet)
CONFIG_DIR="/root/.clawdbot"
CONFIG_FILE="$CONFIG_DIR/clawdbot.json"
TEMPLATE_DIR="/root/.clawdbot-templates"
TEMPLATE_FILE="$TEMPLATE_DIR/moltbot.json.template"

# Get environment-specific backup directory
# This matches the mount path used by src/config.ts:getR2MountPath()
if [ -n "$ENVIRONMENT" ]; then
    BACKUP_DIR="/data/moltbot-$ENVIRONMENT"
    echo "Using environment-specific backup directory: $BACKUP_DIR (ENVIRONMENT=$ENVIRONMENT)"
else
    BACKUP_DIR="/data/moltbot"
    echo "Using default backup directory: $BACKUP_DIR (no ENVIRONMENT set)"
fi

echo "Config directory: $CONFIG_DIR"
echo "Backup directory: $BACKUP_DIR"
```

**Result:**
- Development: Reads from `/data/moltbot-development` ✅
- Production: Reads from `/data/moltbot-production` ✅
- Data persistence works across container restarts ✅

#### 8. `Dockerfile` (Phase 2: Build Cache Update)

**Changes:**
- Updated build cache bust comment to force Docker to rebuild image with updated `start-moltbot.sh`

**Code:**
```dockerfile
# Copy startup script
# Build cache bust: 2026-02-04-v28-r2-restore-path-fix
COPY start-moltbot.sh /usr/local/bin/start-moltbot.sh
```

## Benefits

### 1. Complete Environment Isolation

Each environment has its own dedicated mount path with full read/write isolation, eliminating any possibility of path conflicts or cross-environment data leakage:

- Development data stays in `/data/moltbot-development`
- Production data stays in `/data/moltbot-production`
- No cross-contamination between environments
- **Write operations** (backup sync) use environment-specific paths ✅
- **Read operations** (data restore) use environment-specific paths ✅

**Data Flow Consistency:**

| Operation | Development Path | Production Path |
|-----------|-----------------|-----------------|
| R2 Mount | `/data/moltbot-development` | `/data/moltbot-production` |
| Write (Backup Sync) | `/data/moltbot-development/` | `/data/moltbot-production/` |
| Read (Data Restore) | `/data/moltbot-development/` | `/data/moltbot-production/` |

All three operations (mount, write, read) now consistently use the same environment-specific path, ensuring complete end-to-end isolation.

### 2. Clean Mount Directories

Every environment mounts to a fresh, dedicated directory:

- No "directory is not empty" errors
- No need for special mount options like `nonempty`
- Simpler and more reliable mounting logic

### 3. Clear Visual Identification

The mount path clearly indicates which environment is running:

```bash
# In container, you can immediately see which environment:
$ mount | grep moltbot
s3fs on /data/moltbot-production type fuse.s3fs
```

### 4. Consistent Naming Pattern

Mount paths follow the same naming pattern as bucket names:

```
Pattern: ${base}-${environment}

Bucket:  moltbot-data-production
Path:    /data/moltbot-production
```

This consistency makes the system more intuitive and easier to understand.

### 5. Backward Compatibility

The implementation maintains backward compatibility for systems without an `ENVIRONMENT` variable:

- Falls back to `/data/moltbot` (original path)
- Works with existing bucket `moltbot-data`
- No breaking changes for legacy deployments

## Usage

### Deployment

Mount paths are automatically configured based on the `ENVIRONMENT` variable when deploying:

```bash
# Development deployment
npm run deploy:dev
# → Uses /data/moltbot-development

# Production deployment
npm run deploy:prod
# → Uses /data/moltbot-production
```

### Verification

Check which mount path is being used and verify data restoration:

```bash
# View logs during deployment
wrangler tail --env development

# Expected log output (mounting):
# "Mounting R2 bucket "moltbot-data-development" at /data/moltbot-development"
# "R2 bucket mounted successfully"

# Expected log output (data restoration):
# "Using environment-specific backup directory: /data/moltbot-development (ENVIRONMENT=development)"
# "Config directory: /root/.clawdbot"
# "Backup directory: /data/moltbot-development"
# "Restoring from R2 backup at /data/moltbot-development/clawdbot..."
# "Restored config from R2 backup"
```

**Verify Data Persistence:**

To confirm that data persists across container restarts:

```bash
# 1. Deploy and pair a device
npm run deploy:dev
# Visit /_admin/ and pair a device

# 2. Trigger restart by redeploying
npm run deploy:dev

# 3. Check logs
wrangler tail --env development
# Should see: "Restoring from R2 backup at /data/moltbot-development"

# 4. Verify in admin UI
# Visit /_admin/ - paired device should still be there
```

### Inside Container

If you need to verify the mount path inside a container:

```bash
# List mounts
mount | grep moltbot

# Expected output for development:
# s3fs on /data/moltbot-development type fuse.s3fs

# Check mount directory
ls -la /data/
# drwxr-xr-x moltbot-development
# drwxr-xr-x moltbot-production (if both environments exist)
```

## Testing

All test cases pass with the new implementation:

```bash
npm test
# ✓ 92 tests passed
```

Key test categories:

1. **Default Path Tests** - Verify `/data/moltbot` used when `ENVIRONMENT` not set
2. **Environment-Specific Tests** - Verify correct paths for development/production
3. **Mount Check Tests** - Verify `isR2Mounted()` works with dynamic paths
4. **Sync Tests** - Verify sync commands use correct mount paths

## Configuration

No configuration changes are required. The system automatically uses the correct mount path based on the `ENVIRONMENT` variable set in `wrangler.jsonc`:

```jsonc
{
  "name": "paramita-cloud",
  "main": "src/index.ts",
  "env": {
    "development": {
      "name": "paramita-cloud-development",
      "vars": {
        "ENVIRONMENT": "development"  // → /data/moltbot-development
      }
    },
    "production": {
      "name": "paramita-cloud-production",
      "vars": {
        "ENVIRONMENT": "production"  // → /data/moltbot-production
      }
    }
  }
}
```

## Troubleshooting

### Data Not Persisting Across Restarts (FIXED in Phase 2)

**Symptom:** Paired devices and conversation history are lost every time the container restarts. Logs show "R2 not mounted, starting fresh" even though R2 is mounted.

**Root Cause:** This was caused by the container startup script using a hardcoded backup path (`/data/moltbot`) while R2 was mounted at an environment-specific path (e.g., `/data/moltbot-development`).

**Status:** **FIXED** in Phase 2 (2026-02-04). The startup script now dynamically determines the correct backup path based on the `ENVIRONMENT` variable.

**Verification:** After redeploying with the fix, logs should show:
```
Using environment-specific backup directory: /data/moltbot-development (ENVIRONMENT=development)
Restoring from R2 backup at /data/moltbot-development/clawdbot...
Restored config from R2 backup
```

### Mount Path Not Updating

**Symptom:** Still seeing `/data/moltbot` instead of environment-specific path

**Solution:**
1. Check that `ENVIRONMENT` variable is set in `wrangler.jsonc`
2. Redeploy the worker: `npm run deploy:dev` or `npm run deploy:prod`
3. Check logs: `wrangler tail --env development`

### Old Data Not Accessible

**Symptom:** Data from before the migration is not visible

**Explanation:** This is expected. The old data is in `/data/moltbot`, but the new code looks in `/data/moltbot-development` or `/data/moltbot-production`.

**Solution:**
If you need to preserve old data, manually copy it to the new path inside the container:

```bash
# This is for reference only - you cannot directly execute this
# The container would need to do this on first startup
cp -r /data/moltbot/* /data/moltbot-${ENVIRONMENT}/
```

However, since R2 buckets are separate (e.g., `moltbot-data` vs `moltbot-data-development`), you would need to migrate the R2 bucket data itself if needed.

### Multiple Mount Paths Exist

**Symptom:** Both `/data/moltbot-development` and `/data/moltbot-production` directories exist

**Explanation:** This is normal if both environments have been deployed on the same underlying container at different times.

**Impact:** None. Each environment only mounts to and uses its own path. The directories are isolated.

## Migration Guide

### From Old System (Before Environment Isolation)

If you deployed before this feature was implemented:

**Old Configuration:**
```
Bucket: moltbot-data
Path:   /data/moltbot
```

**New Configuration:**
```
Development:
  Bucket: moltbot-data-development
  Path:   /data/moltbot-development

Production:
  Bucket: moltbot-data-production
  Path:   /data/moltbot-production
```

**Steps:**

1. **Create new environment-specific buckets** (as described in README.md):
   - `moltbot-data-development`
   - `moltbot-data-production`

2. **Update R2 API tokens** to grant access to the new buckets

3. **Set secrets for each environment**:
   ```bash
   # Development
   npx wrangler secret put R2_ACCESS_KEY_ID --env development
   npx wrangler secret put R2_SECRET_ACCESS_KEY --env development
   npx wrangler secret put CF_ACCOUNT_ID --env development

   # Production
   npx wrangler secret put R2_ACCESS_KEY_ID --env production
   npx wrangler secret put R2_SECRET_ACCESS_KEY --env production
   npx wrangler secret put CF_ACCOUNT_ID --env production
   ```

4. **Deploy**:
   ```bash
   npm run deploy:dev
   npm run deploy:prod
   ```

5. **Verify** mount paths in logs:
   ```bash
   wrangler tail --env development
   # Should show: "Mounting R2 bucket "moltbot-data-development" at /data/moltbot-development"
   ```

**Note:** Old data in the legacy `moltbot-data` bucket will not be automatically migrated. If you need to preserve it, manually copy files using the R2 dashboard or S3-compatible tools.

## Related Documentation

- [Deployment Guide](DEPLOYMENT.md) - Complete deployment instructions
- [README.md](../README.md) - Main project documentation
- [Architecture Explanation](architecture_explanation.md) - Overall architecture

## Summary

The R2 environment isolation feature provides:

- ✅ Complete path isolation between environments (both read and write)
- ✅ Clean mount directories (no "not empty" errors)
- ✅ Clear visual identification of environment
- ✅ Consistent naming convention across all operations
- ✅ Backward compatibility
- ✅ Zero configuration required (automatic based on `ENVIRONMENT`)
- ✅ Data persistence across container restarts (Phase 2 fix)
- ✅ End-to-end environment isolation (mount → write → read)

This implementation ensures that development and production environments are completely isolated, with no possibility of cross-contamination or path conflicts. The Phase 2 fix (2026-02-04) completed the isolation by ensuring that data restoration (read path) uses the same environment-specific paths as data backup (write path), enabling proper data persistence across container restarts.

## Implementation Timeline

- **Phase 1 (2026-02-03):** Initial implementation - write path isolation
  - Environment-specific R2 mount paths
  - Dynamic backup sync paths
  - Isolated write operations

- **Phase 2 (2026-02-04):** Read path isolation - cache restore fix
  - Dynamic backup directory in container startup script
  - `ENVIRONMENT` variable propagation to container
  - Complete end-to-end isolation
  - Data persistence across restarts
