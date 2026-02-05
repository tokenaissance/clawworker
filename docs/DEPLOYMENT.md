# 环境配置说明文档

## 配置概览

clawworker 项目现在支持两个独立的部署环境：
- **Production** (生产环境)
- **Development** (开发环境)

## 环境差异

### 1. Worker 名称
- **Production**: `paramita-cloud-production`
- **Development**: `paramita-cloud-development`

### 2. R2 Bucket
- **Production**: `moltbot-data-production`
- **Development**: `moltbot-data-development`

**注意**: 需要在 Cloudflare Dashboard 中创建这两个 bucket

### 3. 环境变量
- **Production**: `ENVIRONMENT=production`
- **Development**: `ENVIRONMENT=development`

### 4. Cron 触发器
- **两个环境都配置为**: 每 5 分钟执行一次 (`*/5 * * * *`)
- **用途**: 同步 moltbot 数据到 R2

## 部署命令

### 部署到生产环境
```bash
npm run deploy:prod
```

### 部署到开发环境
```bash
npm run deploy:dev
```

### 本地开发（生产环境配置）
```bash
npm run start:prod
```

### 本地开发（开发环境配置）
```bash
npm run start:dev
```

## Secret 配置

Secret 名称在两个环境保持一致，但可以配置不同的值。

### 为生产环境配置 Secret
```bash
wrangler secret put ANTHROPIC_API_KEY --env production
wrangler secret put CLAWDBOT_GATEWAY_TOKEN --env production
wrangler secret put R2_ACCESS_KEY_ID --env production
wrangler secret put R2_SECRET_ACCESS_KEY --env production
wrangler secret put CF_ACCOUNT_ID --env production
# ... 其他 secrets
```

### 为开发环境配置 Secret
```bash
wrangler secret put ANTHROPIC_API_KEY --env development
wrangler secret put CLAWDBOT_GATEWAY_TOKEN --env development
wrangler secret put R2_ACCESS_KEY_ID --env development
wrangler secret put R2_SECRET_ACCESS_KEY --env development
wrangler secret put CF_ACCOUNT_ID --env development
# ... 其他 secrets
```

## 必需的 Secrets

### 核心配置
- `ANTHROPIC_API_KEY` - Anthropic API 密钥
- `R2_ACCESS_KEY_ID` - R2 访问密钥 ID
- `R2_SECRET_ACCESS_KEY` - R2 访问密钥
- `CF_ACCOUNT_ID` - Cloudflare 账户 ID

### Cloudflare Access (如果使用)
- `CF_ACCESS_TEAM_DOMAIN` - CF Access 团队域名
- `CF_ACCESS_AUD` - CF Access 应用 AUD

### 必需配置
- `CLAWDBOT_GATEWAY_TOKEN` - Gateway 访问 token（必需）

### 可选配置
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `DISCORD_BOT_TOKEN` - Discord bot token
- `SLACK_BOT_TOKEN` - Slack bot token
- `SLACK_APP_TOKEN` - Slack app token
- `CDP_SECRET` - CDP 端点认证密钥

## 部署前准备

### 1. 创建 R2 Buckets
在 Cloudflare Dashboard 中创建：
- `moltbot-data-production`
- `moltbot-data-development`

### 2. 配置 Secrets
为每个环境配置所需的 secrets（见上文）

### 3. 首次部署
```bash
# 部署到开发环境测试
npm run deploy:dev

# 确认无误后部署到生产环境
npm run deploy:prod
```

## 路由配置（可选）

如果需要配置自定义域名，可以在环境配置中添加 `routes` 或 `route` 字段：

```jsonc
"production": {
  "name": "paramita-cloud-production",
  "routes": [
    { "pattern": "clawbot.yourdomain.com/*", "zone_name": "yourdomain.com" }
  ],
  // ... 其他配置
}
```

## 故障排查

### 查看部署日志
```bash
wrangler tail --env production
wrangler tail --env development
```

### 查看 Secret 列表
```bash
wrangler secret list --env production
wrangler secret list --env development
```

### 删除 Secret
```bash
wrangler secret delete SECRET_NAME --env production
wrangler secret delete SECRET_NAME --env development
```

## 相关文档

关于本次环境配置任务的规划和进度文档：
- [任务计划](deployment/task_plan.md) - 环境配置任务的完整计划和进度
- [配置分析](deployment/findings.md) - 配置发现和技术分析
- [进度日志](deployment/progress.md) - 详细的实施进度记录

