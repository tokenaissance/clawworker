# 用户管理工具使用指南

本工具用于管理本地数据库中的用户实例，包括创建用户和查询用户信息。

**注意：** AI 提供商密钥和部署配置由部署脚本（`deploy-tenant-interactive.ts`）自动管理，此工具仅用于查询。

## 快速开始

### 交互式菜单（推荐）

```bash
npm run manage-users
```

这将启动交互式菜单，提供以下功能：
1. 列出所有用户
2. 查看用户详情
3. 创建新用户
4. 删除用户
5. 查询数据表（交互式选择查看不同表）

### 命令行模式

```bash
# 列出所有用户
npm run manage-users -- list

# 查看用户详情
npm run manage-users -- show user@example.com

# 创建新用户（交互式）
npm run manage-users -- create

# 删除用户（交互式）
npm run manage-users -- delete user@example.com
```

## 功能详解

### 1. 列出所有用户

显示数据库中所有用户的列表，包括：
- 用户 ID（UUID）
- 邮箱
- 名称
- 创建时间

```bash
npm run manage-users -- list
```

输出示例：
```
================================================================================
用户列表
================================================================================
ID                                      邮箱                          名称                创建时间
--------------------------------------------------------------------------------
550e8400-e29b-41d4-a716-446655440000    alice@example.com             Alice               2025-01-15 10:30:00
6ba7b810-9dad-11d1-80b4-00c04fd430c8    bob@example.com               Bob                 2025-01-14 15:20:00
--------------------------------------------------------------------------------
共 2 个用户
```

### 2. 查看用户详情

显示用户的完整信息，包括：
- 基本信息（ID、邮箱、名称、语言等）
- Gateway Token（用于访问 Worker）
- AI 提供商密钥列表
- 部署配置

```bash
npm run manage-users -- show alice@example.com
```

输出示例：
```
================================================================================
用户详情
================================================================================
ID:              550e8400-e29b-41d4-a716-446655440000
邮箱:            alice@example.com
名称:            Alice
邮箱验证:        否
语言:            zh
获客渠道:        未设置
Gateway Token:   a1b2c3d4e5f6g7h8...
创建时间:        2025-01-15 10:30:00
更新时间:        2025-01-15 10:30:00

--------------------------------------------------------------------------------
AI 提供商密钥
--------------------------------------------------------------------------------

提供商:          openrouter
Base URL:        https://openrouter.ai/api/v1
密钥前缀:        sk-or-v1-...
名称:            alice@example.com
额度限制:        $5.00
重置周期:        monthly
状态:            启用
创建时间:        2025-01-15 10:35:00
API Key:         sk-or-v1-abc123def456... (完整密钥)

--------------------------------------------------------------------------------
部署配置
--------------------------------------------------------------------------------
CF Access 域名:  myteam.cloudflareaccess.com
CF Access AUD:   abc123def456...
R2 Key ID:       1234567890abcdef1234...
R2 Secret:       已设置
CF Account ID:   a1b2c3d4e5f6g7h8i9j0
容器休眠时间:    10m
创建时间:        2025-01-15 10:40:00
更新时间:        2025-01-15 10:40:00
================================================================================
```

### 3. 创建新用户

交互式创建新用户，系统会自动生成：
- 用户 ID（UUID）
- Gateway Token（64 位十六进制字符串）

```bash
npm run manage-users -- create
```

交互流程：
```
================================================================================
创建新用户
================================================================================
邮箱: alice@example.com
名称: Alice
语言 [zh]: zh
获客渠道（可选） []: twitter

✅ 用户创建成功！
用户 ID:         550e8400-e29b-41d4-a716-446655440000
Gateway Token:   a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0

请妥善保存 Gateway Token，它将用于访问 Worker。
```

### 4. 更新用户信息

更新用户的基本信息（名称、语言、获客渠道）。

```bash
npm run manage-users -- update alice@example.com
```

交互流程：
```
================================================================================
更新用户信息
================================================================================
提示：直接按回车保持原值不变

名称 [Alice]: Alice Wang
语言 [zh]: zh
获客渠道 [twitter]: twitter

✅ 用户信息已更新
```

### 5. 管理 AI 密钥

为用户添加或更新 AI 提供商的 API 密钥。

支持的提供商：
- `openrouter` - OpenRouter（默认）
- `openai` - OpenAI
- `anthropic` - Anthropic
- `cloudflare-gateway` - Cloudflare AI Gateway

在交互式菜单中选择 "5. 管理 AI 密钥"，然后输入用户邮箱。

交互流程：
```
================================================================================
管理 AI 密钥 - Alice (alice@example.com)
================================================================================
AI 提供商 (openrouter/openai/anthropic/cloudflare-gateway) [openrouter]: openrouter
Base URL [https://openrouter.ai/api/v1]: https://openrouter.ai/api/v1
API Key: sk-or-v1-abc123def456...
额度限制（美分） [500]: 500
重置周期 (daily/weekly/monthly) [monthly]: monthly

✅ AI 密钥已添加
```

**注意事项：**
- API Key 会完整存储在数据库中（明文）
- 系统会自动生成 Key Hash（SHA-256）和 Key Prefix（前 12 位）
- 如果该提供商的密钥已存在，会提示是否更新

### 6. 管理部署配置

配置用户的 Cloudflare 部署相关设置。

在交互式菜单中选择 "6. 管理部署配置"，然后输入用户邮箱。

交互流程：
```
================================================================================
管理部署配置 - Alice (alice@example.com)
================================================================================
提示：直接按回车跳过该项

CF Access 团队域名 []: myteam.cloudflareaccess.com
CF Access AUD []: abc123def456...
R2 Access Key ID []: 1234567890abcdef1234567890abcdef
R2 Secret Access Key []: secret123456...
CF Account ID []: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
容器休眠时间 (e.g., 10m, 1h, never) [never]: 10m

✅ 部署配置已创建
```

**配置说明：**

| 字段 | 说明 | 示例 |
|------|------|------|
| CF Access 团队域名 | Cloudflare Access 团队域名 | `myteam.cloudflareaccess.com` |
| CF Access AUD | Application Audience 标签 | `abc123def456...` |
| R2 Access Key ID | R2 存储访问密钥 ID | `1234567890abcdef...` |
| R2 Secret Access Key | R2 存储访问密钥 Secret | `secret123456...` |
| CF Account ID | Cloudflare 账户 ID | `a1b2c3d4e5f6...` |
| 容器休眠时间 | 容器空闲后休眠时间 | `10m`, `1h`, `never` |

### 7. 删除用户

删除用户及其所有关联数据（AI 密钥、部署配置）。

```bash
npm run manage-users -- delete alice@example.com
```

交互流程：
```
================================================================================
删除用户
================================================================================
用户 ID:   550e8400-e29b-41d4-a716-446655440000
邮箱:      alice@example.com
名称:      Alice
================================================================================

⚠️  确定要删除此用户吗？此操作不可恢复！ [y/N]: y

✅ 用户及其所有关联数据已删除
```

**警告：** 此操作会删除：
- 用户基本信息
- 所有 AI 提供商密钥
- 部署配置

### 5. 查询数据表

交互式查询数据库表，可以选择查看单个表或所有表的数据。

在交互式菜单中选择 "5. 查询数据表"，然后选择要查看的表：

```
================================================================================
数据表查询
================================================================================
1. 用户表 (users)
2. AI 提供商密钥表 (ai_provider_keys)
3. 部署配置表 (user_deployment_configs)
4. 查询所有表
0. 返回主菜单
================================================================================
请选择要查询的表: 1
```

**输出格式：** JSON 格式，便于阅读和处理

**示例输出（用户表）：**
```json
【用户表 (users)】
共 2 条记录

[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Alice",
    "email": "alice@example.com",
    "emailVerified": 0,
    "image": null,
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z",
    "utmSource": "twitter",
    "ip": "",
    "locale": "zh",
    "gatewayToken": "a1b2c3d4e5f6g7h8..."
  }
]
```

**用途：**
- 数据备份和导出
- 调试和故障排查
- 数据审计
- 快速查看表结构和内容

## 数据库结构

工具管理的数据库位于项目根目录：`users.db`

### users 表

存储用户基本信息：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT (PK) | UUID 主键 |
| name | TEXT | 用户名称 |
| email | TEXT (UNIQUE) | 用户邮箱 |
| emailVerified | INTEGER | 邮箱是否验证（0/1） |
| image | TEXT | 头像 URL |
| createdAt | TEXT | 创建时间（ISO 8601） |
| updatedAt | TEXT | 更新时间（ISO 8601） |
| utmSource | TEXT | 获客渠道 |
| ip | TEXT | 注册 IP |
| locale | TEXT | 语言偏好（zh/en） |
| gatewayToken | TEXT | Gateway 访问令牌 |

### ai_provider_keys 表

存储 AI 提供商密钥：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER (PK) | 自增主键 |
| userId | TEXT (FK) | 关联用户 ID |
| provider | TEXT | AI 提供商 |
| baseUrl | TEXT | API 基础 URL |
| keyHash | TEXT | API Key Hash（SHA-256） |
| keyPrefix | TEXT | Key 前缀（用于显示） |
| apiKey | TEXT | 完整 API Key |
| name | TEXT | Key 名称 |
| limitAmount | INTEGER | 额度限制（美分） |
| limitReset | TEXT | 重置周期 |
| disabled | INTEGER | 是否禁用（0/1） |
| createdAt | TEXT | 创建时间（ISO 8601） |

### user_deployment_configs 表

存储部署配置：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER (PK) | 自增主键 |
| userId | TEXT (UNIQUE, FK) | 关联用户 ID |
| cfAccessTeamDomain | TEXT | Cloudflare Access 团队域名 |
| cfAccessAud | TEXT | Cloudflare Access AUD 标签 |
| r2AccessKeyId | TEXT | R2 访问密钥 ID |
| r2SecretAccessKey | TEXT | R2 访问密钥 Secret |
| cfAccountId | TEXT | Cloudflare 账户 ID |
| sandboxSleepAfter | TEXT | 容器休眠时间 |
| createdAt | TEXT | 创建时间（ISO 8601） |
| updatedAt | TEXT | 更新时间（ISO 8601） |

## 工作流程示例

### 完整的用户开通流程

1. **创建用户**
   ```bash
   npm run manage-users -- create
   # 输入邮箱、名称等信息
   # 记录生成的 Gateway Token
   ```

2. **添加 AI 密钥**
   ```bash
   npm run manage-users
   # 选择 "5. 管理 AI 密钥"
   # 输入用户邮箱
   # 配置 OpenRouter API Key
   ```

3. **配置部署**
   ```bash
   npm run manage-users
   # 选择 "6. 管理部署配置"
   # 输入用户邮箱
   # 配置 Cloudflare Access 和 R2
   ```

4. **部署 Worker**
   ```bash
   npm run deploy:tenant -- --email=alice@example.com --name="Alice"
   ```

5. **验证部署**
   ```bash
   npm run manage-users -- show alice@example.com
   # 检查所有配置是否正确
   ```

### 日常维护

**查看所有用户状态：**
```bash
npm run manage-users -- list
```

**更新用户额度：**
```bash
npm run manage-users
# 选择 "5. 管理 AI 密钥"
# 更新 limitAmount
```

**更新部署配置：**
```bash
npm run manage-users
# 选择 "6. 管理部署配置"
# 更新需要修改的字段
```

## 安全注意事项

1. **数据库安全**
   - `users.db` 包含敏感信息（API Keys、Secrets）
   - 确保数据库文件权限正确：`chmod 600 users.db`
   - 不要将数据库文件提交到版本控制系统

2. **Gateway Token**
   - Gateway Token 用于访问 Worker，请妥善保管
   - 建议定期轮换 Token

3. **API Keys**
   - API Keys 以明文存储在数据库中
   - 建议使用文件系统加密或数据库加密
   - 定期检查 API Key 使用情况

4. **备份**
   - 定期备份 `users.db`
   - 备份文件也需要加密存储

## 故障排查

### 数据库文件不存在

```bash
[DB] 数据库路径: /path/to/users.db
```

如果数据库不存在，工具会自动创建。

### 用户邮箱已存在

```
❌ 邮箱已存在: alice@example.com
```

每个邮箱只能创建一个用户。如需修改，使用 `update` 命令。

### 删除用户失败

确保用户存在：
```bash
npm run manage-users -- show alice@example.com
```

### 数据库锁定

如果出现 "database is locked" 错误，确保没有其他进程正在访问数据库。

## 相关文档

- [多租户部署指南](multi-tenant-deployment.md)
- [OpenRouter 配置](openrouter/README.md)
- [部署指南](DEPLOYMENT.md)
