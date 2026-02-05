# Device Pairing Security Model

**Last Updated:** 2026-02-03

## Overview

This document explains the security architecture and design rationale for OpenClaw's device pairing authentication mechanism in the Cloudflare Worker deployment.

## Why Device Pairing?

Device pairing is **not optional** - it's a security requirement of the underlying OpenClaw gateway when running in LAN mode.

### Core Security Requirement

**Source:** `start-moltbot.sh:288-294`, `src/index.ts:58-60`, `docs/deployment/progress.md:47-49`

The `clawdbot gateway` in `--bind lan` mode **MUST** have authentication. It has two options:
- **Token authentication** - Used for the gateway itself
- **Device pairing** - Used for connected clients/devices

### Primary Reasons

1. **Gateway Security Requirement** - The underlying `clawdbot gateway --bind lan` mode requires authentication. While the gateway itself uses token auth, connected clients need device pairing.

2. **Explicit Admin Control** - Unlike token-based auth where anyone with the token can connect, device pairing requires **manual approval** for each device/user.

3. **Multi-User Safety** - In scenarios where multiple people might discover the gateway URL, pairing prevents unauthorized access even if they know the URL.

4. **Channel-Specific Policies** - Allows fine-grained control: Telegram might require pairing while a public web interface might be open.

5. **Audit Trail** - Captures device metadata for security review and compliance.

6. **Best Practice** - README.md explicitly states: "This is the most secure option as it requires explicit approval for each device."

## Multi-Layer Security Architecture

**Source:** `README.md:423-431`

OpenClaw uses **three authentication layers**:

### Layer 1: Cloudflare Access
- Protects admin routes (`/_admin/`, `/api/*`, `/debug/*`)
- Only authenticated CF users can manage devices
- Uses JWT validation with JWKS

### Layer 2: Gateway Token
- Required to access the Control UI
- Pass via `?token=` query parameter
- Set via `CLAWDBOT_GATEWAY_TOKEN` secret

### Layer 3: Device Pairing
- Each device must be explicitly approved
- Default "pairing" DM policy for all channels
- Admin approves via `/_admin/` interface

```
┌─────────────────────────────────────┐
│  Layer 1: Cloudflare Access         │ ← Protects admin routes
├─────────────────────────────────────┤
│  Layer 2: Gateway Token              │ ← Controls Control UI access
├─────────────────────────────────────┤
│  Layer 3: Device Pairing             │ ← Controls device/user access
└─────────────────────────────────────┘
         ▼
┌─────────────────────────────────────┐
│     OpenClaw Gateway                 │
│  - Control UI (port 18789)           │
│  - WebSocket RPC protocol            │
│  - Agent runtime                     │
└─────────────────────────────────────┘
```

## Device Pairing Flow

**Source:** `README.md:165-174`, `src/routes/api.ts:26-173`

### Process

1. A device connects to the gateway
2. The connection is held pending until approved
3. An admin approves the device via `/_admin/` or API
4. The device is now paired and can connect freely

### API Implementation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/devices` | GET | List pending and paired devices |
| `/api/admin/devices/:requestId/approve` | POST | Approve single device |
| `/api/admin/devices/approve-all` | POST | Batch approve all pending |

## Device Metadata Captured

**Source:** `src/client/api.ts:6-31`

When devices request pairing, the system captures:

| Field | Description |
|-------|-------------|
| `requestId` | Unique identifier for the pairing request |
| `deviceId` | Device identifier |
| `displayName` | Human-readable name |
| `platform` | Platform (web, CLI, Telegram, Discord, etc.) |
| `clientId` / `clientMode` | Client information |
| `role` / `roles` / `scopes` | Permission metadata |
| `remoteIp` | Source IP address for audit trail |
| `ts` | Timestamp of request |

## Channel-Specific DM Policies

**Source:** `src/types.ts:25,27`, `start-moltbot.sh:186-201`, `README.md:413-415`

Each channel can have a different DM policy:

### Configuration

```bash
TELEGRAM_DM_POLICY=pairing  # Default
DISCORD_DM_POLICY=pairing   # Default
```

### Modes

| Mode | Behavior | Security |
|------|----------|----------|
| `pairing` (default) | Requires explicit admin approval before DMs are allowed | High security |
| `open` | Allows DMs without approval | Lower security, more convenient |

## Development Mode Bypass

**Source:** `README.md:187`, `start-moltbot.sh:179-183`, `AGENTS.md:46`

For local development only:

```bash
# .dev.vars
DEV_MODE=true
```

This enables `allowInsecureAuth` which:
- Skips Cloudflare Access authentication
- Bypasses device pairing entirely
- **Should ONLY be used for local development**

Maps to container environment variable `CLAWDBOT_DEV_MODE`.

## Security Concerns Addressed

Device pairing addresses these security concerns:

1. **Unauthorized Access Prevention** - Random users cannot connect without explicit approval
2. **Control UI Protection** - Multiple layers (CF Access, Gateway Token, Device Pairing) prevent unauthorized administration
3. **DM Channel Spam/Abuse** - Prevents unsolicited DMs via Telegram/Discord from random users
4. **Audit Trail** - Device metadata (IP, timestamp, platform) logged for security review
5. **Explicit Admin Control** - Requires manual approval, giving admins visibility and control over who connects
6. **Multi-Channel Security** - Different DM policies can be set per channel
7. **Development vs. Production** - Clear distinction with `DEV_MODE` to bypass security for local development only

## Code Locations

| Component | File | Lines |
|-----------|------|-------|
| Device pairing API | `src/routes/api.ts` | 26-173 |
| DM policy configuration | `start-moltbot.sh` | 186-201 |
| Device pairing UI | `src/client/pages/AdminPage.tsx` | 246-335 |
| Device types | `src/client/api.ts` | 6-31 |
| Security documentation | `README.md` | 165-174, 423-431 |
| Dev mode bypass | `start-moltbot.sh` | 179-183 |

## Related Documentation

- [README.md - Device Pairing](../../README.md#device-pairing) - User-facing documentation
- [README.md - Security Considerations](../../README.md#security-considerations) - Security overview
- [AGENTS.md](../../AGENTS.md) - Developer documentation
- [Deployment Guide](../DEPLOYMENT.md) - Deployment configuration
