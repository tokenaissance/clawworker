# Multi-Tenant Deployment Guide

This guide explains how to deploy isolated instances for multiple tenants using the dynamic deployment script.

## Pricing Reference

Based on [Cloudflare Containers Pricing](https://developers.cloudflare.com/containers/pricing/).

### Instance Types

| Type | vCPU | Memory | Disk | Recommended For |
|------|------|--------|------|-----------------|
| `lite` | 1/16 | 256 MiB | 2 GB | Not suitable for OpenClaw |
| `basic` | 1/4 | 1 GiB | 4 GB | Not suitable for OpenClaw |
| `standard-1` | 1/2 | 4 GiB | 8 GB | Light usage, testing |
| `standard-2` | 1 | 6 GiB | 12 GB | Normal usage |
| `standard-3` | 2 | 8 GiB | 16 GB | Heavy usage |
| `standard-4` | 4 | 12 GiB | 20 GB | Enterprise, high concurrency |

### Monthly Cost Estimate (24/7 Running)

Workers Paid Plan includes:
- **Memory**: 25 GiB-hours/month free, then $0.0000025/GiB-second
- **CPU**: 375 vCPU-minutes/month free, then $0.000020/vCPU-second
- **Disk**: 200 GB-hours/month free, then $0.00000007/GB-second

> **Important**: Memory and disk are charged based on **provisioned** resources (always running). CPU is charged based on **actual usage** only.

**Estimated monthly cost for 24/7 operation (730 hours):**

| Instance | Memory + Disk (Fixed) | CPU @ 0% | CPU @ 10% | CPU @ 50% | CPU @ 100% | **Total Range** |
|----------|----------------------|----------|-----------|-----------|------------|-----------------|
| `standard-1` | $27.48 | $0 | $2.58 | $12.92 | $25.83 | **$27 ~ $53** |
| `standard-2` | $41.36 | $0 | $5.21 | $26.06 | $52.11 | **$41 ~ $93** |
| `standard-3` | $55.23 | $0 | $10.47 | $52.34 | $104.67 | **$55 ~ $160** |
| `standard-4` | $82.25 | $0 | $20.98 | $104.90 | $209.79 | **$82 ~ $292** |

**Typical usage scenarios:**

| Scenario | CPU Utilization | Description |
|----------|-----------------|-------------|
| Idle | ~0-5% | Container running, no active requests |
| Light usage | ~5-15% | Occasional chat messages, few users |
| Normal usage | ~15-30% | Regular conversations, moderate traffic |
| Heavy usage | ~50-80% | Continuous AI interactions, multiple users |
| Stress test | ~100% | Benchmark, not typical |

**Realistic cost estimate for typical personal/small team usage (~10% CPU):**

| Instance | Estimated Monthly Cost |
|----------|----------------------|
| `standard-1` | **~$30/month** |
| `standard-2` | **~$47/month** |
| `standard-3` | **~$66/month** |
| `standard-4` | **~$103/month** |

> **Recommendation**: Start with `standard-1` (~$30/month for light usage). OpenClaw's AI processing happens on Anthropic's servers, so local CPU usage is primarily for the gateway and message handling.

### Additional Costs

- **Workers Paid Plan**: $5/month (required)
- **Network Egress**: $0.025/GB (1 TB free in NA/EU)
- **R2 Storage**: Separate charges if enabled
- **Durable Objects**: Included in Workers plan

### Cost Optimization Tips

1. **Use `SANDBOX_SLEEP_AFTER`**: Set containers to sleep after inactivity
   ```bash
   wrangler secret put SANDBOX_SLEEP_AFTER --name paramita-cloud-alice
   # Enter: 10m (sleep after 10 minutes of inactivity)
   ```

2. **Right-size instances**: Start with `standard-1` and upgrade if needed

3. **Monitor usage**: Use Cloudflare dashboard to track actual resource consumption

## Overview

The multi-tenant deployment system allows you to deploy completely isolated instances for different users/organizations. Each tenant gets:

- **Isolated Worker**: `paramita-cloud-{tenant}`
- **Isolated R2 Bucket**: `moltbot-data-{tenant}`
- **Isolated Durable Object**: `moltbot-{tenant}`
- **Isolated Container**: Separate sandbox instance

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Account                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ paramita-cloud- │  │ paramita-cloud- │  │ paramita-cloud- │ │
│  │     alice       │  │      bob        │  │    company-x    │ │
│  │    (Worker)     │  │    (Worker)     │  │    (Worker)     │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐ │
│  │  moltbot-alice  │  │   moltbot-bob   │  │moltbot-company-x│ │
│  │   (Container)   │  │   (Container)   │  │   (Container)   │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │          │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐ │
│  │ moltbot-data-   │  │ moltbot-data-   │  │ moltbot-data-   │ │
│  │     alice       │  │      bob        │  │    company-x    │ │
│  │  (R2 Bucket)    │  │  (R2 Bucket)    │  │  (R2 Bucket)    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Comparison with Environment Deployment

| Feature | Environment (`--env`) | Tenant (`--tenant`) |
|---------|----------------------|---------------------|
| Config file | `wrangler.jsonc` (static) | Generated dynamically |
| Use case | Internal dev/prod | External users |
| Examples | `production`, `development` | `alice`, `bob`, `company-x` |
| Command | `npm run deploy:prod` | `npm run deploy:tenant -- --tenant=alice` |

**Both systems coexist without conflict.**

## Usage

### Basic Deployment

```bash
# Deploy a new tenant
npm run deploy:tenant -- --tenant=alice
```

### With Custom Instance Type

```bash
# Use a larger instance for high-traffic tenants
npm run deploy:tenant -- --tenant=enterprise-client --instance-type=standard-4
```

### Dry Run (Preview)

```bash
# Preview what would be deployed without making changes
npm run deploy:tenant -- --tenant=alice --dry-run
```

### Available Options

| Option | Default | Description |
|--------|---------|-------------|
| `--tenant=<name>` | (required) | Tenant identifier (lowercase, alphanumeric, hyphens) |
| `--instance-type=<type>` | `standard-1` | Container instance type (`standard-1`, `standard-4`, etc.) |
| `--max-instances=<n>` | `1` | Maximum container instances |
| `--dry-run` | `false` | Preview without deploying |

## Tenant Naming Rules

- **Allowed characters**: lowercase letters, numbers, hyphens
- **Format**: Must start and end with alphanumeric character
- **Reserved names**: `production`, `development`, `staging`, `test`, `dev`, `prod`

**Valid examples:**
- `alice`
- `bob`
- `my-company`
- `user123`
- `acme-corp`

**Invalid examples:**
- `Alice` (uppercase)
- `-invalid` (starts with hyphen)
- `production` (reserved)

## Post-Deployment Configuration

After deploying a tenant, configure the required secrets:

```bash
# Required secrets
wrangler secret put ANTHROPIC_API_KEY --name paramita-cloud-alice
wrangler secret put CLAWDBOT_GATEWAY_TOKEN --name paramita-cloud-alice
wrangler secret put CF_ACCESS_TEAM_DOMAIN --name paramita-cloud-alice
wrangler secret put CF_ACCESS_AUD --name paramita-cloud-alice

# Optional: R2 persistence
wrangler secret put R2_ACCESS_KEY_ID --name paramita-cloud-alice
wrangler secret put R2_SECRET_ACCESS_KEY --name paramita-cloud-alice
wrangler secret put CF_ACCOUNT_ID --name paramita-cloud-alice

# Optional: Chat channels
wrangler secret put TELEGRAM_BOT_TOKEN --name paramita-cloud-alice
wrangler secret put DISCORD_BOT_TOKEN --name paramita-cloud-alice
```

## Script Implementation

The deployment script (`scripts/deploy-tenant.ts`) performs the following steps:

1. **Validate tenant name** - Ensures naming rules are followed
2. **Generate wrangler config** - Creates `wrangler.tenant-{tenant}.jsonc`
3. **Create R2 bucket** - Automatically creates `moltbot-data-{tenant}` if it doesn't exist
4. **Build** - Runs `npm run build`
5. **Deploy** - Executes `wrangler deploy --config wrangler.tenant-{tenant}.jsonc`

### Generated Config Structure

```jsonc
{
  "name": "paramita-cloud-{tenant}",
  "main": "src/index.ts",
  "vars": {
    "ENVIRONMENT": "{tenant}"
  },
  "containers": [{
    "class_name": "Sandbox",
    "instance_type": "{instance-type}",
    "max_instances": {max-instances}
  }],
  "r2_buckets": [{
    "binding": "MOLTBOT_BUCKET",
    "bucket_name": "moltbot-data-{tenant}"
  }]
  // ... other standard config
}
```

## Resource Isolation

Each tenant is completely isolated:

| Resource | Isolation Method |
|----------|------------------|
| Worker | Separate Worker deployment |
| Container | Separate Durable Object instance (`moltbot-{tenant}`) |
| Storage | Separate R2 bucket (`moltbot-data-{tenant}`) |
| Secrets | Per-Worker secrets (`--name paramita-cloud-{tenant}`) |
| Logs | Separate Worker logs |

## Cleanup

To remove a tenant:

```bash
# Delete the Worker
wrangler delete --name paramita-cloud-alice

# Delete the R2 bucket (must be empty first)
wrangler r2 bucket delete moltbot-data-alice

# Remove generated config (if kept)
rm wrangler.tenant-alice.jsonc
```

## Troubleshooting

### "Tenant name must be lowercase alphanumeric"

Ensure the tenant name follows the naming rules. Use only lowercase letters, numbers, and hyphens.

### "Reserved environment name"

Names like `production`, `development`, `staging` are reserved for internal use. Choose a different tenant name.

### R2 bucket creation fails

Ensure you have R2 enabled on your Cloudflare account and have the necessary permissions.

### Secrets not working

Remember to use `--name paramita-cloud-{tenant}` when setting secrets, not `--env`.

## See Also

- [Deployment Guide](DEPLOYMENT.md) - Standard environment deployment
- [R2 Environment Isolation](r2-environment-isolation.md) - Storage isolation details
- [Security Architecture](security/README.md) - Security model overview
