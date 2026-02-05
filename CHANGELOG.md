# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **R2 Bucket Mount Path Environment Isolation** - Complete environment isolation for R2 storage
  - Dynamic mount paths based on `ENVIRONMENT` variable
  - Development environment: `/data/moltbot-development`
  - Production environment: `/data/moltbot-production`
  - Backward compatible fallback to `/data/moltbot`
  - See [docs/r2-environment-isolation.md](docs/r2-environment-isolation.md) for details

### Changed
- `src/config.ts`: Replaced hardcoded `R2_MOUNT_PATH` constant with dynamic `getR2MountPath()` function
- `src/gateway/r2.ts`: Updated to use environment-specific mount paths
- `src/gateway/sync.ts`: Updated sync operations to use dynamic mount paths
- `src/routes/api.ts`: Updated storage status endpoint to check correct mount path
- Test suites updated to verify environment-specific behavior

### Fixed
- Eliminated "directory is not empty" errors when switching between environments
- Prevented path conflicts between development and production deployments
- Resolved potential cross-environment data contamination issues

## Previous Features

For detailed information about other features, see:
- [Parameter Injection System](CHANGELOG_PARAMETER_INJECTION.md)
- [Deployment Documentation](docs/DEPLOYMENT.md)
- [Architecture Documentation](docs/architecture-explanation.md)
