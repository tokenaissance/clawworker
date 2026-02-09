# OpenRouter 多租户 API Key 管理

本文档介绍如何使用 OpenRouter Provisioning API 为多租户部署提供独立的 API Key。

## 概述

OpenRouter 是一个 AI 模型路由服务，支持多种模型提供商（Anthropic、OpenAI、Google 等）。通过 Provisioning API，可以为每个租户创建独立的 API Key，实现：

- **费用隔离**：每个租户独立计费
- **额度控制**：为每个 Key 设置使用限额
- **用量追踪**：追踪每个租户的 API 使用量
- **安全隔离**：一个租户的 Key 泄露不影响其他租户

## 架构

```
用户请求 → Worker → OpenRouter API → 各种 AI 模型
              ↓
        租户专属 API Key
        (通过 Provisioning API 创建)
```

## 使用方法

### 1. 获取 Provisioning API Key

1. 访问 [OpenRouter Settings](https://openrouter.ai/settings/keys)
2. 创建一个具有 Provisioning 权限的 API Key
3. 保存这个 Key 作为 `OPENROUTER_PROVISIONING_KEY`

### 2. 运行用户配置脚本

```bash
# 设置 Provisioning Key
export OPENROUTER_PROVISIONING_KEY=sk-or-v1-xxx

# 创建用户和 API Key
npm run provision-user -- --email=user@example.com --name="User Name"

# 指定额度限制（单位：美分，默认 1000 = $10）
npm run provision-user -- --email=user@example.com --name="User Name" --limit=500
```

### 3. 配置 Worker 环境变量

脚本会输出需要配置的环境变量：

```bash
# 为特定租户配置
wrangler secret put AI_GATEWAY_API_KEY --name paramita-cloud-<tenant>
# 粘贴脚本输出的 API Key

wrangler secret put AI_GATEWAY_BASE_URL --name paramita-cloud-<tenant>
# 粘贴: https://openrouter.ai/api/v1
```

## 脚本参数

| 参数 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `--email` | 是 | 用户邮箱（作为 Key 名称） | `user@example.com` |
| `--name` | 是 | 用户显示名称 | `"John Doe"` |
| `--limit` | 否 | 额度限制（美分，默认 1000） | `500` |
| `--utm-source` | 否 | 获客渠道 | `twitter` |
| `--locale` | 否 | 用户语言偏好（默认 en） | `zh` |

## 数据库结构

脚本会在项目根目录创建 `users.db` SQLite 数据库：

### users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (PK) | UUID 主键 |
| name | TEXT | 用户名称 |
| email | TEXT (UNIQUE) | 用户邮箱 |
| emailVerified | INTEGER | 邮箱是否验证 |
| image | TEXT | 头像 URL |
| createdAt | TEXT | 创建时间 |
| updatedAt | TEXT | 更新时间 |
| utmSource | TEXT | 获客渠道 |
| ip | TEXT | 注册 IP |
| locale | TEXT | 语言偏好 |

### openrouter_keys 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER (PK) | 自增主键 |
| userId | TEXT (FK) | 关联用户 ID |
| keyHash | TEXT | OpenRouter Key Hash |
| keyPrefix | TEXT | Key 前缀（用于显示） |
| name | TEXT | Key 名称 |
| limitAmount | INTEGER | 额度限制 |
| limitReset | TEXT | 重置周期 |
| disabled | INTEGER | 是否禁用 |
| createdAt | TEXT | 创建时间 |

## OpenRouter 模型配置

使用 OpenRouter 时，模型 ID 格式为 `provider/model`：

```javascript
// 常用模型示例
'anthropic/claude-3.5-sonnet'     // Claude 3.5 Sonnet
'anthropic/claude-3-opus'         // Claude 3 Opus
'openai/gpt-4-turbo'              // GPT-4 Turbo
'openai/gpt-4o'                   // GPT-4o
'google/gemini-pro-1.5'           // Gemini Pro 1.5
'meta-llama/llama-3.1-70b'        // Llama 3.1 70B
```

完整模型列表请参考 [OpenRouter Models](https://openrouter.ai/models)。

## 额度管理

### 设置额度

创建 Key 时通过 `--limit` 参数设置（单位：美分）：

```bash
# 设置 $5 额度
npm run provision-user -- --email=user@example.com --name="User" --limit=500

# 设置 $100 额度
npm run provision-user -- --email=user@example.com --name="User" --limit=10000
```

### 额度重置

默认每月重置。可通过 OpenRouter Dashboard 或 API 修改为：
- `daily` - 每天 UTC 午夜重置
- `weekly` - 每周一 UTC 午夜重置
- `monthly` - 每月 1 日 UTC 午夜重置

### 查看用量

登录 [OpenRouter Dashboard](https://openrouter.ai/activity) 查看各 Key 的使用情况。

## 安全注意事项

1. **Provisioning Key 保密**：Provisioning Key 可以创建/删除 API Key，必须妥善保管
2. **Key 无法恢复**：API Key 创建后只显示一次，无法从 Hash 恢复完整 Key
3. **定期轮换**：建议定期轮换 API Key
4. **额度告警**：建议设置额度告警，防止意外费用

## 故障排查

### API Key 创建失败

```
Error: Unauthorized
```
- 检查 `OPENROUTER_PROVISIONING_KEY` 是否正确
- 确认 Key 具有 Provisioning 权限

### 模型请求失败

```
Error: Model not found
```
- 检查模型 ID 格式是否正确（`provider/model`）
- 确认模型在 OpenRouter 上可用

### 额度不足

```
Error: Rate limit exceeded
```
- 检查 Key 额度设置
- 通过 Dashboard 查看用量

## 相关文档

- [OpenRouter 官方文档](https://openrouter.ai/docs)
- [OpenRouter API 参考](https://openrouter.ai/docs/api-reference)
- [多租户部署指南](../multi-tenant-deployment.md)
