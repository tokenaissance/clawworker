# Multi-Tenant Deployment Guide

This guide explains how to deploy isolated instances for multiple tenants using the dynamic deployment script.

## Pricing Reference

Based on [Cloudflare Containers Pricing](https://developers.cloudflare.com/containers/pricing/) and [Limits](https://developers.cloudflare.com/containers/platform-details/limits/).

### Instance Types

| Type | vCPU | Memory | Disk | 适用场景 |
|------|------|--------|------|----------|
| `lite` | 1/16 | 256 MiB | 2 GB | 极轻量测��� |
| `basic` | 1/4 | 1 GiB | 4 GB | 轻量工作负载 |
| `standard-1` | 1/2 | 4 GiB | 8 GB | 生产环境（推荐） |
| `standard-2` | 1 | 6 GiB | 12 GB | 中等工作负载 |
| `standard-3` | 2 | 8 GiB | 16 GB | 重度工作负载 |
| `standard-4` | 4 | 12 GiB | 20 GB | 高性能需求 |

> **Note**: 本项目 Docker 镜像约 3.3GB，需要至少 `standard-1`（8GB 磁盘）才能运行。`basic` 的 4GB 磁盘不够用。

### Platform Limits (Open Beta)

| 限制项 | 数值 |
|--------|------|
| 并发实例总内存 | 400 GiB |
| 并发实例总 vCPU | 100 |
| 并发实例总磁盘 | 2 TB |
| 单个镜像大小 | 等同于实例磁盘空间 |
| 账户镜像存储总量 | 50 GB |

### Pricing Details

**Workers Paid Plan**: $5/month（必需）

**计算资源**（按 10ms 计费）：

| 资源 | 免费额度/月 | 超出后价格 |
|------|------------|-----------|
| Memory | 25 GiB-hours | $0.0000025/GiB-second |
| CPU | 375 vCPU-minutes | $0.000020/vCPU-second |
| Disk | 200 GB-hours | $0.00000007/GB-second |

> Memory 和 Disk 按预配资源计费，CPU 按实际使用计费。

**网络流量**：

| 区域 | 免费额度/月 | 超出后价格 |
|------|------------|-----------|
| 北美 & 欧洲 | 1 TB | $0.025/GB |
| 大洋洲、韩国、台湾 | 500 GB | $0.05/GB |
| 其他区域 | 500 GB | $0.04/GB |

### Cost Estimation (per tenant)

以 `standard-1` 实例（1/2 vCPU, 4 GiB Memory, 8 GB Disk）为例：

#### 场景 1：几乎不使用（容器每天运行 1 小时）

| 资源 | 月用量 | 免费额度 | 超出量 | 费用 |
|------|--------|---------|--------|------|
| Memory | 4 GiB × 30h = 120 GiB-h | 25 GiB-h | 95 GiB-h | $0.86 |
| CPU | ~0.1 vCPU × 30h = 180 min | 375 min | 0 | $0.00 |
| Disk | 8 GB × 30h = 240 GB-h | 200 GB-h | 40 GB-h | $0.01 |
| Network | ~1 GB | 1 TB | 0 | $0.00 |
| **Total** | | | | **~$0.87/月** |

#### 场景 2：重度使用（容器 24/7 运行）

| 资源 | 月用量 | 免费额度 | 超出量 | 费用 |
|------|--------|---------|--------|------|
| Memory | 4 GiB × 720h = 2880 GiB-h | 25 GiB-h | 2855 GiB-h | $25.70 |
| CPU | ~0.25 vCPU × 720h = 10800 min | 375 min | 10425 min | $12.51 |
| Disk | 8 GB × 720h = 5760 GB-h | 200 GB-h | 5560 GB-h | $1.40 |
| Network | ~50 GB | 1 TB | 0 | $0.00 |
| **Total** | | | | **~$39.61/月** |

> **注意**：以上为单租户估算。免费额度是账户级别共享的，多租户时需要按比例分摊。

### Additional Costs

- **Workers Paid Plan**: $5/month (required, shared across all tenants)
- **R2 Storage**: Separate charges if enabled (see [R2 Pricing](https://developers.cloudflare.com/r2/pricing/))
- **Durable Objects**: Included in Workers plan

### Cost Optimization Tips

1. **Use `SANDBOX_SLEEP_AFTER`**: Set containers to sleep after inactivity
   ```bash
   wrangler secret put SANDBOX_SLEEP_AFTER --name paramita-cloud-alice
   # Enter: 10m (sleep after 10 minutes of inactivity)
   ```

2. **Right-size instances**: Use `standard-1` for most cases, upgrade only if needed

3. **Monitor usage**: Use Cloudflare dashboard to track actual resource consumption

4. **Share free tier**: Deploy multiple low-usage tenants to share the free tier allowance

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

### Interactive Deployment (Recommended)

The interactive deployment script combines tenant deployment, OpenRouter API key provisioning, and secret configuration in one workflow:

```bash
# Full interactive deployment with OpenRouter provisioning
npm run deploy:interactive -- --email=user@example.com --name="User Name"

# With custom instance type
npm run deploy:interactive -- --email=user@example.com --name="User Name" --instance-type=standard

# Preview without deploying
npm run deploy:interactive -- --email=user@example.com --name="User Name" --dry-run

# Skip OpenRouter provisioning (use existing API key)
npm run deploy:interactive -- --email=user@example.com --name="User Name" --skip-provision
```

The script will:
1. Derive tenant name from email (e.g., `user@example.com` → `user`)
2. Create OpenRouter API key for the user (if `OPENROUTER_PROVISIONING_KEY` is set)
3. Deploy the tenant Worker
4. Interactively prompt for all required secrets
5. Auto-generate `CLAWDBOT_GATEWAY_TOKEN`

#### Interactive Options

| Option | Default | Description |
|--------|---------|-------------|
| `--email=<email>` | (required) | User email (used to derive tenant name) |
| `--name=<name>` | (required) | User display name |
| `--tenant=<name>` | (from email) | Override tenant name |
| `--instance-type=<type>` | `standard-1` | Container instance type |
| `--limit=<cents>` | `500` | OpenRouter credit limit in cents ($5 default) |
| `--skip-provision` | `false` | Skip OpenRouter API key creation |
| `--dry-run` | `false` | Preview without deploying |
| `--force-build` | `false` | Force Docker rebuild even if no changes detected |

#### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_PROVISIONING_KEY` | OpenRouter provisioning API key (optional, can be entered interactively) |

### Smart Build Detection

The deployment script automatically detects changes in Docker context files:
- `Dockerfile`
- `start-moltbot.sh`
- `moltbot.json.template`
- `skills/`

If no changes are detected since the last deployment, the build step is skipped to save time. Use `--force-build` to override this behavior.

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

The interactive deployment script handles secrets configuration automatically. If you need to manually update secrets later:

```bash
# Required secrets
wrangler secret put AI_GATEWAY_API_KEY --name paramita-cloud-alice
wrangler secret put CLAWDBOT_GATEWAY_TOKEN --name paramita-cloud-alice
wrangler secret put CF_ACCESS_TEAM_DOMAIN --name paramita-cloud-alice
wrangler secret put CF_ACCESS_AUD --name paramita-cloud-alice

# Optional: R2 persistence
wrangler secret put R2_ACCESS_KEY_ID --name paramita-cloud-alice
wrangler secret put R2_SECRET_ACCESS_KEY --name paramita-cloud-alice
wrangler secret put CF_ACCOUNT_ID --name paramita-cloud-alice
```

## Script Implementation

The deployment script (`scripts/deploy-tenant-interactive.ts`) performs the following steps:

1. **Get or create user** - Creates user record in local database
2. **Provision OpenRouter API key** - Creates per-user API key with credit limit
3. **Check existing Worker** - Prompts to redeploy if Worker already exists
4. **Generate wrangler config** - Creates `wrangler.tenant-{tenant}.jsonc`
5. **Create R2 bucket** - Automatically creates `moltbot-data-{tenant}` if it doesn't exist
6. **Build and deploy** - Runs `npm run build` and `wrangler deploy`
7. **Configure secrets** - Checks existing secrets and prompts before overwriting

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
