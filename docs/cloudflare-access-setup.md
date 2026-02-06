# Cloudflare Access Setup Scripts

这些脚本用于自动化配置 Cloudflare Access，保护你的 Workers。

## 脚本说明

### 1. `test-cloudflare-access-api.sh`
测试 Cloudflare Access API 连接和权限。

### 2. `setup-cloudflare-access.sh`
自动创建 Cloudflare Access 应用和策略。

## 前置要求

### 创建 API Token

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 选择 "Create Custom Token"
4. 添加以下权限：
   - **Account > Access: Organizations, Identity Providers, and Groups > Edit**
   - **Account > Access: Apps and Policies > Edit**
5. 点击 "Continue to summary"
6. 点击 "Create Token"
7. 复制生成的 token

### 设置环境变量

```bash
export CLOUDFLARE_API_TOKEN="your-api-token-here"
```

## 使用步骤

### 步骤 1: 测试 API 连接

首先测试你的 API token 是否有正确的权限：

```bash
./scripts/test-cloudflare-access-api.sh
```

**预期输出：**
```
==========================================
Cloudflare Access API Test
==========================================

1. Getting account ID...
✓ Account ID: 165537dbf09fa012d4e5ec25dc66392b

2. Testing Access organization endpoint...
✓ Access organization endpoint accessible
  Team domain: your-team.cloudflareaccess.com

3. Testing Access applications endpoint...
✓ Access applications endpoint accessible
  Existing applications: 0

4. Checking API token permissions...
✓ API token is valid
  Status: active

==========================================
✓ All tests passed!
==========================================
```

### 步骤 2: 为 Worker 配置 Access

为你的 Worker 创建 Access 应用和策略：

```bash
./scripts/setup-cloudflare-access.sh \
  --worker=paramita-cloud-tenant-id \
  --email=user@example.com
```

**参数说明：**
- `--worker`: Worker 名称（必需）
- `--email`: 允许访问的邮箱地址（必需）
- `--team-domain`: Cloudflare Access 团队域名（可选，会自动获取）

**预期输出：**
```
==========================================
Cloudflare Access Setup
==========================================
Worker:       paramita-cloud-tenant-id
URL:          https://paramita-cloud-tenant-id.workers.dev
Allow email:  user@example.com
Team domain:  your-team.cloudflareaccess.com
==========================================

Creating Access application...
✓ Access application created
Application ID: abc123...
Application Audience (AUD): def456...

Creating Access policy (allow user@example.com)...
✓ Access policy created
Policy ID: ghi789...

==========================================
✓ Cloudflare Access Setup Complete!
==========================================

Configuration details:
  Worker URL:        https://paramita-cloud-tenant-id.workers.dev
  Team Domain:       your-team.cloudflareaccess.com
  Application AUD:   def456...
  Allowed Email:     user@example.com

Next steps:
  1. Set these secrets in your Worker:
     CF_ACCESS_TEAM_DOMAIN=your-team.cloudflareaccess.com
     CF_ACCESS_AUD=def456...

  2. Test access by visiting:
     https://paramita-cloud-tenant-id.workers.dev

  3. You should be prompted to authenticate with your email
```

### 步骤 3: 设置 Worker Secrets

使用脚本输出的值设�� Worker secrets：

```bash
# 设置 team domain
echo "your-team.cloudflareaccess.com" | npx wrangler secret put CF_ACCESS_TEAM_DOMAIN --name paramita-cloud-tenant-id

# 设置 AUD
echo "def456..." | npx wrangler secret put CF_ACCESS_AUD --name paramita-cloud-tenant-id
```

## 集成到部署脚本

你可以将 Access 配置集成到 `deploy-tenant-interactive.ts` 中：

```typescript
// 在部署完成后自动配置 Access
if (!config.dryRun && shouldConfigureAccess) {
  console.log('\n[Access] Configuring Cloudflare Access...');

  const accessScript = path.join(__dirname, 'setup-cloudflare-access.sh');
  const accessResult = spawnSync(accessScript, [
    `--worker=${workerName}`,
    `--email=${config.email}`
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || ''
    }
  });

  if (accessResult.status === 0) {
    console.log('[Access] ✓ Cloudflare Access configured');
  } else {
    console.warn('[Access] Failed to configure Access automatically');
    console.warn('[Access] Please configure manually or run:');
    console.warn(`[Access]   ./scripts/setup-cloudflare-access.sh --worker=${workerName} --email=${config.email}`);
  }
}
```

## API 文档参考

- [Access Applications API](https://developers.cloudflare.com/api/operations/access-applications-add-an-access-application)
- [Access Policies API](https://developers.cloudflare.com/api/operations/access-policies-create-an-access-policy)
- [Access Organizations API](https://developers.cloudflare.com/api/operations/access-organizations-get-an-access-organization)

## 故障排除

### 错误: "Could not determine account ID"
确保你已经登录 wrangler：
```bash
npx wrangler login
```

### 错误: "Access organization endpoint failed"
你的账户可能还没有启用 Cloudflare Access。请先在 Cloudflare Dashboard 中启用 Zero Trust。

### 错误: "API token verification failed"
检查你的 API token 是否有正确的权限。重新创建 token 并确保包含所需的 Access 权限。

### 应用已存在
如果 Access 应用已经存在，脚本会显示现有的 AUD 并退出。如果需要更新策略，请先在 Dashboard 中删除现有应用，或手动修改。

## 安全注意事项

1. **保护你的 API Token**: 不要将 API token 提交到 git 仓库
2. **使用环境变量**: 始终通过环境变量传递敏感信息
3. **最小权限原则**: API token 只授予必需的权限
4. **定期轮换**: 定期更新你的 API token

## 限制

- 目前脚本只支持基于邮箱的访问策略
- 不支持多个邮箱或复杂的策略规则
- 不支持自定义身份提供商（IdP）配置

如需更复杂的配置，请使用 Cloudflare Dashboard 或直接调用 API。
