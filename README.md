# OpenClaw on Cloudflare Workers

Run [OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot, formerly Clawdbot) personal AI assistant in a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/).

![moltworker architecture](./assets/logo.png)

> **Experimental:** This is a proof of concept demonstrating that OpenClaw can run in Cloudflare Sandbox. It is not officially supported and may break without notice. Use at your own risk.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/moltworker)

## Requirements

- [Workers Paid plan](https://www.cloudflare.com/plans/developer-platform/) ($5 USD/month) — required for Cloudflare Sandbox containers
- [Anthropic API key](https://console.anthropic.com/) — for Claude access, or you can use AI Gateway's [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)

The following Cloudflare features used by this project have free tiers:
- Cloudflare Access (authentication)
- Browser Rendering (for browser navigation)
- AI Gateway (optional, for API routing/analytics)
- R2 Storage (optional, for persistence)

## What is OpenClaw?

[OpenClaw](https://github.com/openclaw/openclaw) (formerly Moltbot, formerly Clawdbot) is a personal AI assistant with a gateway architecture that connects to multiple chat platforms. Key features:

- **Control UI** - Web-based chat interface at the gateway
- **Multi-channel support** - Telegram, Discord, Slack
- **Device pairing** - Secure DM authentication requiring explicit approval
- **Persistent conversations** - Chat history and context across sessions
- **Agent runtime** - Extensible AI capabilities with workspace and skills

This project packages OpenClaw to run in a [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/) container, providing a fully managed, always-on deployment without needing to self-host. Optional R2 storage enables persistence across container restarts.

## Architecture

![moltworker architecture](./assets/architecture.png)

## Quick Start

_Cloudflare Sandboxes are available on the [Workers Paid plan](https://dash.cloudflare.com/?to=/:account/workers/plans)._

This project supports multiple deployment environments. You can deploy to **development** (for testing) or **production** (for live deployment). Secrets must be configured separately for each environment.

```bash
# Install dependencies
npm install

# Set your API key for development environment (direct Anthropic access)
npx wrangler secret put ANTHROPIC_API_KEY --env development

# Or use AI Gateway instead (see "Optional: Cloudflare AI Gateway" below)
# npx wrangler secret put AI_GATEWAY_API_KEY --env development
# npx wrangler secret put AI_GATEWAY_BASE_URL --env development

# Generate and set a gateway token (required for remote access)
# Save this token - you'll need it to access the Control UI
export CLAWDBOT_GATEWAY_TOKEN=$(openssl rand -hex 32)
echo "Your gateway token: $CLAWDBOT_GATEWAY_TOKEN"
echo "$CLAWDBOT_GATEWAY_TOKEN" | npx wrangler secret put CLAWDBOT_GATEWAY_TOKEN --env development

# Deploy to development environment (recommended for first deployment)
npm run deploy:dev

# Or deploy to production environment
# npm run deploy:prod
```

After deploying, you can access the Control UI:

```
# Development environment
https://paramita-cloud-development.your-subdomain.workers.dev/

# Production environment
https://paramita-cloud-production.your-subdomain.workers.dev/
```

Replace `your-subdomain` with your Cloudflare account subdomain.

**Note:** The first request may take 1-2 minutes while the container starts.

### Automatic Parameter Injection

The Worker **automatically injects** the gateway token when forwarding requests to the Gateway container. You don't need to manually add `?token=xxx` to URLs anymore.

**How it works**:
1. You access: `https://worker.example.com/`
2. Worker automatically injects: `?token=xxx` when forwarding to Gateway
3. Gateway receives: `http://localhost:8787/?token=xxx`

This happens **server-side**, so your token is never exposed in your browser's address bar. The gateway token acts as the second layer of security (after Cloudflare Access) to ensure requests are coming from your Worker and not directly to the Gateway.

For more details about the parameter injection system, see the [Parameter Injection Documentation](docs/parameter-injection.md).

> **Important:** You will not be able to use the Control UI until you complete the following steps. You MUST:
> 1. [Set up Cloudflare Access](#setting-up-the-admin-ui) to protect the admin UI
> 2. [Pair your device](#device-pairing) via the admin UI at `/_admin/`

You'll also likely want to [enable R2 storage](#persistent-storage-r2) so your paired devices and conversation history persist across container restarts (optional but recommended).

For more detailed information about environment configuration and deployment options, see the [Deployment Guide](docs/DEPLOYMENT.md).

## Setting Up the Admin UI

To use the admin UI at `/_admin/` for device management, you need to:
1. Enable Cloudflare Access on your worker
2. Set the Access secrets so the worker can validate JWTs

### 1. Enable Cloudflare Access on workers.dev

The easiest way to protect your worker is using the built-in Cloudflare Access integration for workers.dev:

1. Go to the [Workers & Pages dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
2. Select your Worker (e.g., `clawbot-sandbox`)
3. In **Settings**, under **Domains & Routes**, in the `workers.dev` row, click the meatballs menu (`...`)
4. Click **Enable Cloudflare Access**
5. Click **Manage Cloudflare Access** to configure who can access:
   - Add your email address to the allow list
   - Or configure other identity providers (Google, GitHub, etc.)
6. Copy the **Application Audience (AUD)** tag from the Access application settings. This will be your `CF_ACCESS_AUD` in Step 2 below

### 2. Set Access Secrets

After enabling Cloudflare Access, set the secrets so the worker can validate JWTs:

```bash
# For development environment
# Your Cloudflare Access team domain (e.g., "myteam.cloudflareaccess.com")
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --env development

# The Application Audience (AUD) tag from your Access application that you copied in the step above
npx wrangler secret put CF_ACCESS_AUD --env development

# For production environment, repeat with --env production
# npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --env production
# npx wrangler secret put CF_ACCESS_AUD --env production
```

You can find your team domain in the [Zero Trust Dashboard](https://one.dash.cloudflare.com/) under **Settings** > **Custom Pages** (it's the subdomain before `.cloudflareaccess.com`).

### 3. Redeploy

```bash
# Deploy to development environment
npm run deploy:dev

# Or deploy to production environment
# npm run deploy:prod
```

Now visit `/_admin/` and you'll be prompted to authenticate via Cloudflare Access before accessing the admin UI.

### Alternative: Manual Access Application

If you prefer more control, you can manually create an Access application:

1. Go to [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
2. Navigate to **Access** > **Applications**
3. Create a new **Self-hosted** application
4. Set the application domain to your Worker URL (e.g., `clawbot-sandbox.your-subdomain.workers.dev`)
5. Add paths to protect: `/_admin/*`, `/api/*`, `/debug/*`
6. Configure your desired identity providers (e.g., email OTP, Google, GitHub)
7. Copy the **Application Audience (AUD)** tag and set the secrets as shown above

### Local Development

For local development, create a `.dev.vars` file with:

```bash
DEV_MODE=true               # Skip Cloudflare Access auth + bypass device pairing
DEBUG_ROUTES=true           # Enable /debug/* routes (optional)
```

You can also test with environment-specific configurations using `npm run start:dev` or `npm run start:prod`.

## Authentication

By default, moltbot uses **device pairing** for authentication. When a new device (browser, CLI, etc.) connects, it must be approved via the admin UI at `/_admin/`.

### Device Pairing

1. A device connects to the gateway
2. The connection is held pending until approved
3. An admin approves the device via `/_admin/`
4. The device is now paired and can connect freely

This is the most secure option as it requires explicit approval for each device.

### Gateway Token (Required)

A gateway token is required to access the Control UI when hosted remotely. Pass it as a query parameter:

```
https://your-worker.workers.dev/?token=YOUR_TOKEN
wss://your-worker.workers.dev/ws?token=YOUR_TOKEN
```

**Note:** Even with a valid token, new devices still require approval via the admin UI at `/_admin/` (see Device Pairing above).

For local development only, set `DEV_MODE=true` in `.dev.vars` to skip Cloudflare Access authentication and enable `allowInsecureAuth` (bypasses device pairing entirely).

## Persistent Storage (R2)

By default, moltbot data (configs, paired devices, conversation history) is lost when the container restarts. To enable persistent storage across sessions, configure R2:

> **Note on Environment Isolation:** Each environment (development/production) uses its own isolated R2 bucket and mount path to prevent data conflicts. See the [R2 Environment Isolation documentation](docs/r2-environment-isolation.md) for details.

### 1. Create R2 API Token

First, create the R2 buckets for your environments in the [Cloudflare Dashboard](https://dash.cloudflare.com/):
- **Development**: `moltbot-data-development`
- **Production**: `moltbot-data-production`

Then, create an R2 API token:

1. Go to **R2** > **Overview** in the [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click **Manage R2 API Tokens**
3. Create a new token with **Object Read & Write** permissions
4. Select the appropriate bucket for your environment
5. Copy the **Access Key ID** and **Secret Access Key**

### 2. Set Secrets

```bash
# For development environment
npx wrangler secret put R2_ACCESS_KEY_ID --env development
npx wrangler secret put R2_SECRET_ACCESS_KEY --env development
npx wrangler secret put CF_ACCOUNT_ID --env development

# For production environment
# npx wrangler secret put R2_ACCESS_KEY_ID --env production
# npx wrangler secret put R2_SECRET_ACCESS_KEY --env production
# npx wrangler secret put CF_ACCOUNT_ID --env production
```

To find your Account ID: Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/), click the three dots menu next to your account name, and select "Copy Account ID".

### How It Works

R2 storage uses a backup/restore approach for simplicity:

**On container startup:**
- If R2 is mounted and contains backup data, it's restored to the moltbot config directory
- OpenClaw uses its default paths (no special configuration needed)

**During operation:**
- A cron job runs every 5 minutes to sync the moltbot config to R2
- You can also trigger a manual backup from the admin UI at `/_admin/`

**In the admin UI:**
- When R2 is configured, you'll see "Last backup: [timestamp]"
- Click "Backup Now" to trigger an immediate sync

Without R2 credentials, moltbot still works but uses ephemeral storage (data lost on container restart).

## Container Lifecycle

By default, the sandbox container stays alive indefinitely (`SANDBOX_SLEEP_AFTER=never`). This is recommended because cold starts take 1-2 minutes.

To reduce costs for infrequently used deployments, you can configure the container to sleep after a period of inactivity:

```bash
npx wrangler secret put SANDBOX_SLEEP_AFTER --env development
# Enter: 10m (or 1h, 30m, etc.)

# For production environment
# npx wrangler secret put SANDBOX_SLEEP_AFTER --env production
```

When the container sleeps, the next request will trigger a cold start. If you have R2 storage configured, your paired devices and data will persist across restarts.

## Admin UI

![admin ui](./assets/adminui.png)

Access the admin UI at `/_admin/` to:
- **R2 Storage Status** - Shows if R2 is configured, last backup time, and a "Backup Now" button
- **Restart Gateway** - Kill and restart the moltbot gateway process
- **Device Pairing** - View pending requests, approve devices individually or all at once, view paired devices

The admin UI requires Cloudflare Access authentication (or `DEV_MODE=true` for local development).

## Debug Endpoints

Debug endpoints are available at `/debug/*` when enabled (requires `DEBUG_ROUTES=true` and Cloudflare Access):

- `GET /debug/processes` - List all container processes
- `GET /debug/logs?id=<process_id>` - Get logs for a specific process
- `GET /debug/version` - Get container and moltbot version info

## Optional: Chat Channels

### Telegram

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --env development
npm run deploy:dev
```

### Discord

```bash
npx wrangler secret put DISCORD_BOT_TOKEN --env development
npm run deploy:dev
```

### Slack

```bash
npx wrangler secret put SLACK_BOT_TOKEN --env development
npx wrangler secret put SLACK_APP_TOKEN --env development
npm run deploy:dev
```

## Optional: Browser Automation (CDP)

This worker includes a Chrome DevTools Protocol (CDP) shim that enables browser automation capabilities. This allows OpenClaw to control a headless browser for tasks like web scraping, screenshots, and automated testing.

### Setup

1. Set a shared secret for authentication:

```bash
npx wrangler secret put CDP_SECRET --env development
# Enter a secure random string
```

2. Set your worker's public URL:

```bash
npx wrangler secret put WORKER_URL --env development
# Enter: https://paramita-cloud-development.your-subdomain.workers.dev
```

3. Redeploy:

```bash
npm run deploy:dev
```

### Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /cdp/json/version` | Browser version information |
| `GET /cdp/json/list` | List available browser targets |
| `GET /cdp/json/new` | Create a new browser target |
| `WS /cdp/devtools/browser/{id}` | WebSocket connection for CDP commands |

All endpoints require the `CDP_SECRET` header for authentication.

## Built-in Skills

The container includes pre-installed skills in `/root/clawd/skills/`:

### cloudflare-browser

Browser automation via the CDP shim. Requires `CDP_SECRET` and `WORKER_URL` to be set (see [Browser Automation](#optional-browser-automation-cdp) above).

**Scripts:**
- `screenshot.js` - Capture a screenshot of a URL
- `video.js` - Create a video from multiple URLs
- `cdp-client.js` - Reusable CDP client library

**Usage:**
```bash
# Screenshot
node /root/clawd/skills/cloudflare-browser/scripts/screenshot.js https://example.com output.png

# Video from multiple URLs
node /root/clawd/skills/cloudflare-browser/scripts/video.js "https://site1.com,https://site2.com" output.mp4 --scroll
```

See `skills/cloudflare-browser/SKILL.md` for full documentation.

## Optional: Cloudflare AI Gateway

You can route API requests through [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/) for caching, rate limiting, analytics, and cost tracking. AI Gateway supports multiple providers — configure your preferred provider in the gateway and use these env vars:

### Setup

1. Create an AI Gateway in the [AI Gateway section](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway/create-gateway) of the Cloudflare Dashboard.
2. Add a provider (e.g., Anthropic) to your gateway
3. Set the gateway secrets:

You'll find the base URL on the Overview tab of your newly created gateway. At the bottom of the page, expand the **Native API/SDK Examples** section and select "Anthropic".

```bash
# Your provider's API key (e.g., Anthropic API key)
npx wrangler secret put AI_GATEWAY_API_KEY --env development

# Your AI Gateway endpoint URL
npx wrangler secret put AI_GATEWAY_BASE_URL --env development
# Enter: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic
```

4. Redeploy:

```bash
npm run deploy:dev
```

The `AI_GATEWAY_*` variables take precedence over `ANTHROPIC_*` if both are set.

## All Secrets Reference

**Note on Environments:** All secrets should be configured separately for each deployment environment using the `--env` flag. For example:
- Development: `npx wrangler secret put SECRET_NAME --env development`
- Production: `npx wrangler secret put SECRET_NAME --env production`

| Secret | Required | Description |
|--------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes* | API key for your AI Gateway provider (requires `AI_GATEWAY_BASE_URL`) |
| `AI_GATEWAY_BASE_URL` | Yes* | AI Gateway endpoint URL (required when using `AI_GATEWAY_API_KEY`) |
| `ANTHROPIC_API_KEY` | Yes* | Direct Anthropic API key (fallback if AI Gateway not configured) |
| `ANTHROPIC_BASE_URL` | No | Direct Anthropic API base URL (fallback) |
| `OPENAI_API_KEY` | No | OpenAI API key (alternative provider) |
| `CF_ACCESS_TEAM_DOMAIN` | Yes* | Cloudflare Access team domain (required for admin UI) |
| `CF_ACCESS_AUD` | Yes* | Cloudflare Access application audience (required for admin UI) |
| `CLAWDBOT_GATEWAY_TOKEN` | Yes | Gateway token for authentication (pass via `?token=` query param) |
| `DEV_MODE` | No | Set to `true` to skip CF Access auth + device pairing (local dev only) |
| `DEBUG_ROUTES` | No | Set to `true` to enable `/debug/*` routes |
| `SANDBOX_SLEEP_AFTER` | No | Container sleep timeout: `never` (default) or duration like `10m`, `1h` |
| `R2_ACCESS_KEY_ID` | No | R2 access key for persistent storage |
| `R2_SECRET_ACCESS_KEY` | No | R2 secret key for persistent storage |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID (required for R2 storage) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_DM_POLICY` | No | Telegram DM policy: `pairing` (default) or `open` |
| `DISCORD_BOT_TOKEN` | No | Discord bot token |
| `DISCORD_DM_POLICY` | No | Discord DM policy: `pairing` (default) or `open` |
| `SLACK_BOT_TOKEN` | No | Slack bot token |
| `SLACK_APP_TOKEN` | No | Slack app token |
| `CDP_SECRET` | No | Shared secret for CDP endpoint authentication (see [Browser Automation](#optional-browser-automation-cdp)) |
| `WORKER_URL` | No | Public URL of the worker (required for CDP) |

## Security Considerations

### Authentication Layers

OpenClaw in Cloudflare Sandbox uses a three-layer security model (defense-in-depth):

1. **Cloudflare Access (Layer 1)** - Protects admin routes (`/_admin/`, `/api/*`, `/debug/*`). Only authenticated users can access the Worker. This validates user identity.

2. **Gateway Token (Layer 2)** - **Automatically injected** by the Worker when forwarding requests to the Gateway container. This ensures requests are coming from your Worker and not directly to the Gateway container. The token is stored securely in Worker environment variables and never exposed to users.

3. **Device Pairing (Layer 3)** - Each device (browser, CLI, chat platform DM) must be explicitly approved via the admin UI before it can interact with the assistant. This is the default "pairing" DM policy and provides per-device authorization.

**Why three layers?**
- **Layer 1** prevents unauthorized users from accessing your Worker
- **Layer 2** prevents bypassing the Worker and directly attacking the Gateway container
- **Layer 3** prevents one compromised device from affecting others

For more details, see the [Parameter Injection Documentation](docs/parameter-injection.md) and [Architecture Explanation](docs/architecture-explanation.md).

## Troubleshooting

**`npm run dev` fails with an `Unauthorized` error:** You need to enable Cloudflare Containers in the [Containers dashboard](https://dash.cloudflare.com/?to=/:account/workers/containers)

**Gateway fails to start:** Check `npx wrangler secret list` and `npx wrangler tail`

**Config changes not working:** Edit the `# Build cache bust:` comment in `Dockerfile` and redeploy

**Slow first request:** Cold starts take 1-2 minutes. Subsequent requests are faster.

**R2 not mounting:** Check that all three R2 secrets are set (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`). Note: R2 mounting only works in production, not with `wrangler dev`.

**Access denied on admin routes:** Ensure `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, and that your Cloudflare Access application is configured correctly.

**Devices not appearing in admin UI:** Device list commands take 10-15 seconds due to WebSocket connection overhead. Wait and refresh.

**WebSocket issues in local development:** `wrangler dev` has known limitations with WebSocket proxying through the sandbox. HTTP requests work but WebSocket connections may fail. Deploy to Cloudflare for full functionality.

## Documentation

For detailed deployment and configuration guides, see the [docs/](docs/) directory:

- **[Deployment Guide](docs/DEPLOYMENT.md)** - Complete guide for deploying to production and development environments
- **[R2 Environment Isolation](docs/r2-environment-isolation.md)** - R2 bucket mount path environment isolation implementation
- **[Parameter Injection](docs/parameter-injection.md)** - URL parameter injection system design and API reference
- **[Architecture Explanation](docs/architecture-explanation.md)** - Detailed architecture explanation (Chinese)
- **[Security Architecture](docs/security/README.md)** - Three-layer security model overview
- **[Device Pairing](docs/security/device-pairing.md)** - Device pairing mechanism details
- **[Documentation Index](docs/README.md)** - Full documentation index including planning documents

## Links

- [OpenClaw](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai/)
- [Cloudflare Sandbox Docs](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Access Docs](https://developers.cloudflare.com/cloudflare-one/policies/access/)
