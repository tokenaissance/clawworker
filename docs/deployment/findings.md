# 环境配置发现和分析

## Gateway Token 认证机制分析 (2026-02-03)

### Token 命名约定

| 位置 | 变量名 | 说明 |
|------|--------|------|
| CF Worker 环境变量 | `MOLTBOT_GATEWAY_TOKEN` | 用户在 Dashboard 配置 |
| 容器内环境变量 | `CLAWDBOT_GATEWAY_TOKEN` | clawdbot 程序期望的名字 |

### 映射关系

`src/gateway/env.ts:46-47`:
```typescript
// Map MOLTBOT_GATEWAY_TOKEN to CLAWDBOT_GATEWAY_TOKEN (container expects this name)
if (env.MOLTBOT_GATEWAY_TOKEN) envVars.CLAWDBOT_GATEWAY_TOKEN = env.MOLTBOT_GATEWAY_TOKEN;
```

### Gateway 认证模式

`clawdbot gateway` 支持两种认证模式：

1. **Token 认证** (`--token`)
   - 客户端通过 `?token=xxx` 参数访问
   - 适合自动化、API 调用
   - **LAN 模式必需**

2. **Device Pairing 认证**
   - 通过 `/_admin/` 页面交互式配对
   - 需要人工操作
   - 不适合容器环境

### 为什么 Token 是必需的

`start-moltbot.sh` 中固定使用 `--bind lan` 模式：
```bash
BIND_MODE="lan"
exec clawdbot gateway --port 18789 --bind "$BIND_MODE" [--token ...]
```

`clawdbot gateway` 在 LAN 模式下的安全策略：
- **必须有认证**才能绑定到 LAN
- 没有 token 时会拒绝启动：`Refusing to bind gateway to lan without auth`

### 结论

在当前架构下，`MOLTBOT_GATEWAY_TOKEN` 是**必需的**环境变量，原因：
1. 容器使用 LAN 绑定模式
2. LAN 模式要求认证
3. Device Pairing 不适合无人值守环境
4. 因此必须使用 Token 认证

---

## 当前配置分析

### R2 Bucket 当前配置
```jsonc
"r2_buckets": [
  {
    "binding": "MOLTBOT_BUCKET",
    "bucket_name": "moltbot-data"
  }
]
```

### Cron 触发器当前配置
```jsonc
"triggers": {
  "crons": ["*/5 * * * *"]  // 每 5 分钟执行一次
}
```

**用途**：根据注释，用于 "sync moltbot data to R2 every 5 minutes"

### Secret 配置需求
根据代码注释，需要配置的 secrets：
- `ANTHROPIC_API_KEY`
- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `TELEGRAM_BOT_TOKEN` (optional)
- `DISCORD_BOT_TOKEN` (optional)
- `SLACK_BOT_TOKEN` (optional)
- `SLACK_APP_TOKEN` (optional)
- `MOLTBOT_GATEWAY_TOKEN` (optional)
- `CDP_SECRET` (optional)
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `CF_ACCOUNT_ID`

## 环境差异设计

### 已完成配置 ✅
1. **Worker 名称** ✅ 已配置
   - Production: `paramita-cloud-production`
   - Development: `paramita-cloud-development`

2. **R2 Bucket** ✅ 已配置
   - Production: `moltbot-data-production`
   - Development: `moltbot-data-development`

3. **环境变量** ✅ 已配置
   - Production: `ENVIRONMENT=production`
   - Development: `ENVIRONMENT=development`

4. **Cron 触发器** ✅ 已配置
   - 两个环境都配置为 `*/5 * * * *`（每 5 分钟）
   - 用途：同步 moltbot 数据到 R2

### 待完成配置（部署前必需）
1. **创建 R2 Buckets**
   - 需在 Cloudflare Dashboard 或通过 CLI 创建
   - `moltbot-data-production`
   - `moltbot-data-development`

2. **配置 Secrets**
   - 每个环境需要独立配置 secrets
   - 使用 `wrangler secret put --env [production|development]`

### 可选配置
3. **路由/域名** ⏳ 可选
   - 如不配置，默认使用 `*.workers.dev` 域名
   - 如需自定义域名，在环境配置中添加 `routes` 字段

### 不需要区分的配置
- Secret 名称（但值可以不同）
- Container 配置
- Durable Objects 配置
- Assets 配置
- Browser binding
