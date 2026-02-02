# Security Documentation

This directory contains detailed security documentation for the OpenClaw Cloudflare Worker deployment.

## Documents

### [Device Pairing](device-pairing.md)
Comprehensive analysis of the device pairing authentication mechanism, including:
- Why device pairing is required
- Multi-layer security architecture
- Device pairing flow and API
- Channel-specific DM policies
- Development mode bypass
- Security concerns addressed

## Security Architecture Overview

The deployment uses a three-layer security model:

```
┌─────────────────────────────────────┐
│  Layer 1: Cloudflare Access         │ ← Admin route protection
├─────────────────────────────────────┤
│  Layer 2: Gateway Token              │ ← Control UI access control
├─────────────────────────────────────┤
│  Layer 3: Device Pairing             │ ← Device/user access control
└─────────────────────────────────────┘
```

## Quick Reference

### Production Security Checklist

- [ ] Cloudflare Access configured for `/_admin/*` routes
- [ ] `CLAWDBOT_GATEWAY_TOKEN` set and kept secret
- [ ] Device pairing enabled (default `pairing` DM policy)
- [ ] `DEV_MODE` is NOT set in production
- [ ] R2 credentials secured if persistence is enabled

### Development Environment

For local development only:

```bash
# .dev.vars
DEV_MODE=true           # Bypasses CF Access + device pairing
DEBUG_ROUTES=true       # Enables /debug/* endpoints
```

**Never use `DEV_MODE=true` in production.**

## Related Documentation

- [Main README](../../README.md) - User-facing setup and configuration
- [Deployment Guide](../DEPLOYMENT.md) - Complete deployment instructions
- [Agent Instructions](../../AGENTS.md) - Developer guidelines
