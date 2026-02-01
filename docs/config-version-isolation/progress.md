# Progress Log: Configuration Version Isolation

## Session 1: 2026-02-01

### Initial Planning
- Created task plan for configuration version isolation
- Researched current config loading mechanism
- Investigated version detection options
- Analyzed git tag availability (currently no tags in repo)

### Key Findings
1. **Current state:** No git tags exist in repository
2. **Config loading:** start-moltbot.sh controls entire config lifecycle
3. **Best approach:** Build-time version injection via esbuild define
4. **Version format:** `{git_tag}_{unix_timestamp}`

### Design Decisions
1. ✅ Use separate config files per version: `clawdbot.{version}_{timestamp}.json`
2. ✅ Inject version at build time using esbuild define
3. ✅ Pass version from Worker to container via environment variable
4. ✅ Implement retention policy for old config versions (keep last 10)

### Design Decisions (User Confirmed)
1. ✅ **No symlink:** Directly use versioned filename, no backward compat symlink
2. ✅ **Fail-fast:** Block deployment if version injection fails (Option B)
3. ✅ **Manual cleanup:** Keep all versions, clean up manually when needed (Option C)

### Next Actions
- [ ] Create first git tag (v1.0.0)
- [ ] Implement version injection in build script
- [ ] Modify start-moltbot.sh to use versioned configs
- [ ] Update R2 sync logic
- [ ] Write migration code for legacy config
- [ ] Add retention cleanup cron job

### Blockers
None currently.

### Notes
- User confirmed approach: "方案一 (separate config files by version)"
- User specified version format: "git tag + timestamp"
- This is a continuation from the GATEWAY_TOKEN removal work
- Current issue: Old config in R2 still has token, causing WebSocket error

---

## Session Template (for future sessions)

### Summary
Successfully implemented configuration version isolation using separate config files per version.

### Code Changes
1. **scripts/get-version.js** - Created version detection script that generates `{git_tag}_{timestamp}`
2. **vite.config.ts** - Added version injection at build time using Vite define
3. **src/types.ts** - Added CONFIG_VERSION to MoltbotEnv interface
4. **src/index.ts** - Declared __CONFIG_VERSION__ global and injected into env via middleware
5. **src/gateway/env.ts** - Pass CONFIG_VERSION to container environment
6. **start-moltbot.sh** - Modified to use versioned config files with migration logic
7. **src/gateway/sync.ts** - Updated R2 sync to handle versioned config files

### Testing Results
✅ Build succeeds with version injection: `v1.0.0-dirty_1769953117`
✅ Version is properly injected via Vite define
✅ All TypeScript types updated
✅ Migration logic added for legacy configs

### Issues Encountered
- Initial shebang syntax error in get-version.js - Fixed by removing shebang
- esbuild was trying to parse the script as part of bundle - Fixed by removing CLI execution code

### Next Session Goals
1. Deploy and test in actual Worker environment
2. Verify config isolation works across deployments
3. Test rollback scenarios
4. Document the new config versioning system

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| Planning | 2026-02-01 | Initial planning and research | ✅ Complete |
| v1.0.0 | TBD | Implement version isolation | 🔄 Pending |
