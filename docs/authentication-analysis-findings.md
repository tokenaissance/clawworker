# Research Findings: 认证机制分析

## 项目基本信息
- **项目名称**: clawworker
- **主要功能**: Cloudflare Worker，作为 clawdbot gateway 的前端代理
- **技术栈**: TypeScript, Hono, Cloudflare Workers
- **Git 分支**: develop

---

## 代码结构发现

### 核心文件清单

#### 主入口和路由
- **src/index.ts** (413 lines) - Worker 主入口，定义所有路由和中间件
- **src/types.ts** (75 lines) - TypeScript 类型定义，包括环境变量接口
- **src/config.ts** - 配置常量定义

#### 认证相关
- **src/auth/middleware.ts** (126 lines) - CF Access 认证中间件实现
- **src/auth/jwt.ts** (38 lines) - JWT 验证逻辑（使用 jose 库）
- **src/auth/index.ts** - Auth 模块导出

#### Gateway 管理
- **src/gateway/env.ts** (63 lines) - 构建传递给容器的环境变量
- **src/gateway/process.ts** (125 lines) - Gateway 进程管理（启动、查找、等待）
- **src/gateway/index.ts** - Gateway 模块导出
- **src/gateway/r2.ts** - R2 存储挂载
- **src/gateway/sync.ts** - R2 备份同步
- **src/gateway/utils.ts** - 工具函数

#### 路由模块
- **src/routes/index.ts** - 路由导出
- **src/routes/public.ts** - 公开路由（健康检查、静态资源等）
- **src/routes/api.ts** - API 路由（受 CF Access 保护）
- **src/routes/admin-ui.ts** - 管理界面路由（受 CF Access 保护）
- **src/routes/debug.ts** - 调试路由（受 CF Access 保护，需要 DEBUG_ROUTES=true）
- **src/routes/cdp.ts** - CDP 路由（使用共享密钥认证，不使用 CF Access）

#### 测试文件
- **src/auth/jwt.test.ts**
- **src/auth/middleware.test.ts**
- **src/gateway/env.test.ts**
- **src/gateway/process.test.ts**
- **src/gateway/r2.test.ts**
- **src/gateway/sync.test.ts**

### 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                         │
│                      (src/index.ts)                          │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Public      │  │ CF Access    │  │ Gateway Proxy    │  │
│  │ Routes      │  │ Middleware   │  │ (WebSocket +     │  │
│  │             │  │              │  │  HTTP)           │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│                           ↓                   ↓             │
│                    ┌──────────────────────────┐            │
│                    │   Sandbox Container      │            │
│                    │   (Moltbot Gateway)      │            │
│                    │   Port: 3000             │            │
│                    └──────────────────────────┘            │
└─────────────────��───────────────────────────────────────────┘
```

### 路由结构

1. **公开路由**（不需要认证）
   - `/sandbox-health` - 健康检查
   - `/logo.png`, `/logo-small.png` - 静态资源
   - `/api/status` - 状态 API
   - `/_admin/assets/*` - 管理界面静态资源
   - `/cdp/*` - CDP 路由（使用 CDP_SECRET 认证）

2. **受保护路由**（需要 CF Access 认证）
   - `/api/*` - API 路由
   - `/_admin/*` - 管理界面
   - `/debug/*` - 调试路由（需要额外的 DEBUG_ROUTES=true）
   - `/` 及其他路径 - 代理到 Gateway

---

## Token 模式发现

### 环境变量
- **CLAWDBOT_GATEWAY_TOKEN** (string, optional) - Gateway Token 用于容器认证
  - 定义位置: `src/types.ts:18`
  - 使用位置: `src/gateway/env.ts:47-49`, `src/index.ts:61-63`

### 工作流程

#### 当前系统的 Token 使用方式

根据代码分析，当前系统**只在一个地方**使用 CLAWDBOT_GATEWAY_TOKEN：

**在 `src/gateway/env.ts:47-49`**:
```typescript
// Gateway token
if (env.CLAWDBOT_GATEWAY_TOKEN) {
  envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN;
}
```

**作用**: 将 Worker 的环境变量传递给容器内的 Gateway 进程。

#### 容器内的 Gateway 如何使用 Token

Token 被传递给容器后，由 `/usr/local/bin/start-moltbot.sh` 启动脚本使用：
- 如果设置了 `CLAWDBOT_GATEWAY_TOKEN`，Gateway 会在 `--bind lan` 模式下要求客户端提供匹配的 token
- Token 通过查询参数传递：`/?token=xxx`
- Gateway 验证 token 是否与配置的值匹配

#### Worker 层面的"Token 模式"

**重要发现**: Worker 代码中**没有**在请求代理到 Gateway 之前验证 Token。

检查了以下关键位置：
1. `src/index.ts:55-85` - `validateRequiredEnv()` - 只验证 token **是否存在**，不验证其值
2. `src/index.ts:188-197` - CF Access 中间件 - **没有**跳过 CF Access 的逻辑
3. `src/index.ts:218-385` - Gateway 代理逻辑 - **没有**检查或转发 token

### 关键代码位置

#### 环境变量验证 (src/index.ts:55-85)
```typescript
function validateRequiredEnv(env: MoltbotEnv): string[] {
  const missing: string[] = [];

  // Gateway token is required for container authentication
  if (!env.CLAWDBOT_GATEWAY_TOKEN) {
    missing.push('CLAWDBOT_GATEWAY_TOKEN');
  }

  if (!env.CF_ACCESS_TEAM_DOMAIN) {
    missing.push('CF_ACCESS_TEAM_DOMAIN');
  }

  if (!env.CF_ACCESS_AUD) {
    missing.push('CF_ACCESS_AUD');
  }
  // ... 其他验证
  return missing;
}
```

**发现**:
- **CLAWDBOT_GATEWAY_TOKEN** 是必需的
- **CF_ACCESS_TEAM_DOMAIN** 和 **CF_ACCESS_AUD** 也是必需的
- 这意味着当前系统**同时要求** Token 和 CF Access 配置

#### Gateway 环境变量构建 (src/gateway/env.ts:46-49)
```typescript
// Gateway token
if (env.CLAWDBOT_GATEWAY_TOKEN) {
  envVars.CLAWDBOT_GATEWAY_TOKEN = env.CLAWDBOT_GATEWAY_TOKEN;
}
```

#### CF Access 中间件应用 (src/index.ts:188-197)
```typescript
// Middleware: Cloudflare Access authentication for protected routes
app.use('*', async (c, next) => {
  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  const middleware = createAccessMiddleware({
    type: acceptsHtml ? 'html' : 'json',
    redirectOnMissing: acceptsHtml
  });

  return middleware(c, next);
});
```

**关键发现**: CF Access 中间件**无条件应用**到所有保护的路由，没有检查 CLAWDBOT_GATEWAY_TOKEN 是否存在的逻辑。

---

## CF Access 模式发现

### 环境变量
- **CF_ACCESS_TEAM_DOMAIN** (string, required) - Cloudflare Access 团队域名
  - 例如: `myteam.cloudflareaccess.com`
  - 定义位置: `src/types.ts:31`

- **CF_ACCESS_AUD** (string, required) - Application Audience (AUD) 标签
  - 定义位置: `src/types.ts:32`

- **DEV_MODE** (string, optional) - 设置为 'true' 跳过 CF Access 认证
  - 定义位置: `src/types.ts:21`

### 工作流程

#### JWT 提取 (src/auth/middleware.ts:25-33)
```typescript
export function extractJWT(c: Context<AppEnv>): string | null {
  const jwtHeader = c.req.header('CF-Access-JWT-Assertion');
  const jwtCookie = c.req.raw.headers.get('Cookie')
    ?.split(';')
    .find(cookie => cookie.trim().startsWith('CF_Authorization='))
    ?.split('=')[1];

  return jwtHeader || jwtCookie || null;
}
```

**工作原理**:
1. 优先从 `CF-Access-JWT-Assertion` header 读取
2. 如果没有，从 `CF_Authorization` cookie 读取
3. 都没有则返回 null

#### JWT 验证 (src/auth/jwt.ts:16-37)
```typescript
export async function verifyAccessJWT(
  token: string,
  teamDomain: string,
  expectedAud: string
): Promise<JWTPayload> {
  const issuer = teamDomain.startsWith('https://')
    ? teamDomain
    : `https://${teamDomain}`;

  // 从 Cloudflare 获取 JWKS
  const JWKS = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

  // 使用 jose 库验证 JWT
  const { payload } = await jwtVerify(token, JWKS, {
    issuer,
    audience: expectedAud,
  });

  return payload as unknown as JWTPayload;
}
```

**验证步骤**:
1. 从 `https://{teamDomain}/cdn-cgi/access/certs` 获取公钥
2. 使用 jose 库验证 JWT 签名
3. 验证 issuer 匹配
4. 验证 audience (AUD) 匹配
5. 验证过期时间
6. 返回 payload（包含用户信息：email, name, sub 等）

#### 中间件流程 (src/auth/middleware.ts:41-125)

```typescript
export function createAccessMiddleware(options: AccessMiddlewareOptions) {
  return async (c: Context<AppEnv>, next: Next) => {
    // 1. DEV_MODE 跳过
    if (isDevMode(c.env)) {
      c.set('accessUser', { email: 'dev@localhost', name: 'Dev User' });
      return next();
    }

    // 2. 检查配置
    const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
    const expectedAud = c.env.CF_ACCESS_AUD;
    if (!teamDomain || !expectedAud) {
      return c.json({ error: 'Cloudflare Access not configured' }, 500);
    }

    // 3. 提取 JWT
    const jwt = extractJWT(c);
    if (!jwt) {
      // 如果是 HTML 请求且 redirectOnMissing，重定向到登录
      if (type === 'html' && redirectOnMissing) {
        return c.redirect(`https://${teamDomain}`, 302);
      }
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // 4. 验证 JWT
    try {
      const payload = await verifyAccessJWT(jwt, teamDomain, expectedAud);
      c.set('accessUser', { email: payload.email, name: payload.name });
      await next();
    } catch (err) {
      return c.json({ error: 'Unauthorized', details: ... }, 401);
    }
  };
}
```

### 关键代码位置

#### 中间件应用点 (src/index.ts:188-197)
```typescript
// Middleware: Cloudflare Access authentication for protected routes
app.use('*', async (c, next) => {
  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  const middleware = createAccessMiddleware({
    type: acceptsHtml ? 'html' : 'json',
    redirectOnMissing: acceptsHtml
  });

  return middleware(c, next);
});
```

**应用范围**: 所有保护的路由（在公开路由挂载之后）

#### 保护的路由
- `/api/*` - API 路由 (src/index.ts:200)
- `/_admin/*` - 管理界面 (src/index.ts:203)
- `/debug/*` - 调试路由 (src/index.ts:206-212，需要额外的 DEBUG_ROUTES=true)
- `/` 及其他 - Gateway 代理 (src/index.ts:218-385)

### DEV_MODE 行为
当 `DEV_MODE=true` 时：
- 跳过 CF Access 认证
- 跳过环境变量验证（src/index.ts:159-162）
- 设置虚拟用户: `{ email: 'dev@localhost', name: 'Dev User' }`

---

## 模式切换机制

### 重要发现：当前系统**同时需要** Token 和 CF Access

通过完整的代码分析，我发现了**关键事实**：

**当前系统要求 CLAWDBOT_GATEWAY_TOKEN 和 CF Access 同时存在，而不是二选一！**

### 决策逻辑分析

#### Worker 层面的验证 (src/index.ts:55-85)

```typescript
function validateRequiredEnv(env: MoltbotEnv): string[] {
  const missing: string[] = [];

  // Gateway token is required for container authentication
  if (!env.CLAWDBOT_GATEWAY_TOKEN) {
    missing.push('CLAWDBOT_GATEWAY_TOKEN');
  }

  if (!env.CF_ACCESS_TEAM_DOMAIN) {
    missing.push('CF_ACCESS_TEAM_DOMAIN');
  }

  if (!env.CF_ACCESS_AUD) {
    missing.push('CF_ACCESS_AUD');
  }

  // ... 省略 AI Gateway 检查
  return missing;
}
```

**关键点**:
- 所有三个变量都是**独立检查**的
- **没有** "要么 Token，要么 CF Access" 的逻辑
- 任何一个缺失都会报错（除非 DEV_MODE=true）

#### 中间件应用 (src/index.ts:188-197)

```typescript
// Middleware: Cloudflare Access authentication for protected routes
app.use('*', async (c, next) => {
  const acceptsHtml = c.req.header('Accept')?.includes('text/html');
  const middleware = createAccessMiddleware({
    type: acceptsHtml ? 'html' : 'json',
    redirectOnMissing: acceptsHtml
  });

  return middleware(c, next);
});
```

**关键点**:
- **没有条件判断** CLAWDBOT_GATEWAY_TOKEN 的存在
- CF Access 中间件**总是应用**（DEV_MODE 除外）
- **不存在** "如果有 Token 就跳过 CF Access" 的逻辑

#### Gateway 启动逻辑 (start-moltbot.sh:174-182, 288-292)

```bash
# JavaScript 配置部分 (行 174-182)
if (process.env.CLAWDBOT_GATEWAY_TOKEN) {
    config.gateway.auth = config.gateway.auth || {};
    config.gateway.auth.token = process.env.CLAWDBOT_GATEWAY_TOKEN;
}

if (process.env.CLAWDBOT_DEV_MODE === 'true') {
    config.gateway.controlUi = config.gateway.controlUi || {};
    config.gateway.controlUi.allowInsecureAuth = true;
}

# Gateway 启动命令 (行 288-292)
if [ -n "$CLAWDBOT_GATEWAY_TOKEN" ]; then
    echo "Starting gateway with token authentication..."
    exec clawdbot gateway --port 18789 --verbose --allow-unconfigured --bind "$BIND_MODE" --token "$CLAWDBOT_GATEWAY_TOKEN"
else
    # ...
fi
```

**关键点**:
- Token 存在时：Gateway 启动时带 `--token` 参数，要求客户端提供匹配的 token
- DEV_MODE 时：设置 `allowInsecureAuth = true`，绕过所有认证

### 当前系统的实际架构

#### 生产环境（Token + CF Access 双重认证）

```
用户请求
  ↓
公开路由？
  ↓ No
DEV_MODE？
  ↓ No (生产环境)
环境变量完整？��Token + CF Access + API Key）
  ↓ Yes
【第一层】应用 CF Access 中间件
  ↓
验证 JWT（CF_Authorization cookie/header）
  ↓ 通过
代理到 Gateway（容器端口 18789）
  ↓
【第二层】Gateway 验证 token 参数
  ↓
检查 URL 中的 ?token=xxx
  ↓ 匹配 CLAWDBOT_GATEWAY_TOKEN
【第三层】设备配对检查
  ↓
设备已配对？
  ↓ Yes
允许连接
```

#### 开发环境（DEV_MODE=true）

```
用户请求
  ↓
DEV_MODE？
  ↓ Yes
跳过 CF Access 中间件
  ↓
代理到 Gateway
  ↓
Gateway allowInsecureAuth=true
  ↓
跳过 Token 验证
跳过设备配对
  ↓
允许连接
```

### 三层安全模型

当前系统实现的是**三层防御**:

| 层级 | 位置 | 作用 | 可绕过条件 |
|------|------|------|-----------|
| **Layer 1: CF Access** | Worker 中间件 | 保护 Worker 路由，验证用户身份 | DEV_MODE=true |
| **Layer 2: Gateway Token** | Gateway 启动参数 | 保护 Gateway 端点，验证请求来源 | DEV_MODE=true 或 token 不设置 |
| **Layer 3: Device Pairing** | Gateway 内部 | 每个设备需管理员批准 | DEV_MODE=true |

### 用户提到的"模式切换"在哪里？

**问题**: 用户说 "CLAWDBOT_GATEWAY_TOKEN 被设置时，系统自动运行在 Token 模式，而不是 CF Access 模式"

**真相**:
1. **代码中不存在这个逻辑** - Worker 代码没有任何地方检查 Token 来决定是否跳过 CF Access
2. **可能的混淆来源**:
   - 文档 `docs/security/README.md` 和 `docs/security/device-pairing.md` 提到三层安全
   - Gateway 的 DEV_MODE 可以绕过所有认证
   - 但这不是"Token 模式 vs CF Access 模式"的互斥关系

### 技术限制

#### Gateway 的两种运行模式

Gateway 确实有两种互斥的认证模式：

1. **Token 模式**:
   ```bash
   clawdbot gateway --token "$CLAWDBOT_GATEWAY_TOKEN"
   ```
   - 要求所有请求带 `?token=xxx` 参数
   - 严格验证 token 匹配

2. **Insecure 模式**:
   ```javascript
   config.gateway.controlUi.allowInsecureAuth = true;
   ```
   - 不验证 token
   - 不验证设备配对
   - **仅用于开发**

但这是 **Gateway 内部**的模式，不影响 Worker 层的 CF Access 中间件。

---

## 设备配对机制

### 实现细节

设备配对是 Gateway 内部的第三层安全机制，与 Token 和 CF Access 独立工作。

#### 配置位置
- **DM Policy 环境变量**: `src/types.ts:25,27`
  - `TELEGRAM_DM_POLICY` (default: 'pairing')
  - `DISCORD_DM_POLICY` (default: 'pairing')

#### 启动脚本配置 (start-moltbot.sh:186-201)
```javascript
// Telegram configuration
if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram.dmPolicy = process.env.TELEGRAM_DM_POLICY || 'pairing';
}

// Discord configuration
if (process.env.DISCORD_BOT_TOKEN) {
    config.channels.discord.dmPolicy = process.env.DISCORD_DM_POLICY || 'pairing';
}
```

#### API 端点 (src/routes/api.ts)
| 端点 | 方法 | 描述 |
|-----|------|------|
| `/api/admin/devices` | GET | 列出待批准和已配对的设备 |
| `/api/admin/devices/:requestId/approve` | POST | 批准单个设备 |
| `/api/admin/devices/approve-all` | POST | 批量批准所有待批准设备 |

#### 设备元数据
捕获的信息包括：
- `requestId` - 唯一配对请求ID
- `deviceId` - 设备标识符
- `displayName` - 可读名称
- `platform` - 平台（web, CLI, Telegram, Discord 等）
- `remoteIp` - 来源 IP（审计追踪）
- `ts` - 请求时间戳

### 安全模型

#### 三层防御深度

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Cloudflare Access (Worker Middleware)          │
│ ├─ Protects: /_admin/*, /api/*, /debug/*, /            │
│ ├─ Method: JWT validation (CF_Authorization cookie)     │
│ └─ Bypass: DEV_MODE=true                                │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Gateway Token (Container Startup Parameter)    │
│ ├─ Protects: Gateway endpoint (port 18789)              │
│ ├─ Method: --token parameter validation                 │
│ └─ Bypass: DEV_MODE → allowInsecureAuth=true            │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Device Pairing (Gateway Internal)              │
│ ├─ Protects: Per-device authorization                   │
│ ├─ Method: Admin approval via /_admin/devices           │
│ └─ Bypass: DEV_MODE → allowInsecureAuth=true            │
└─────────────────────────────────────────────────────────┘
```

#### DM Policy 模式

| 模式 | 行为 | 安全级别 |
|-----|------|---------|
| `pairing` (默认) | 需要管理员明确批准才能发送 DM | 高安全 |
| `open` | 无需批准即可发送 DM | 低安全，更方便 |

#### DEV_MODE 的作用

当 `DEV_MODE=true` 时（仅用于本地开发）：
- **Worker 层**: 跳过 CF Access 验证，设置虚拟用户
- **Gateway 层**: 设置 `allowInsecureAuth=true`，跳过 Token 和设备配对

映射关系：
```
Worker: DEV_MODE=true
  ↓ (src/gateway/env.ts:50)
Container: CLAWDBOT_DEV_MODE=true
  ↓ (start-moltbot.sh:179-183)
Gateway: config.gateway.controlUi.allowInsecureAuth = true
```

### 工作流程

#### 正常设备配对流程

```
1. 设备尝试连接 Gateway
   ↓
2. Gateway 检测到未配对设备
   ↓
3. Gateway 保持连接挂起（pending）
   ↓
4. 设备信息显示在 /_admin/devices
   ↓
5. 管理员通过 CF Access 登录
   ↓
6. 管理员审查设备信息（IP、平台、时间等）
   ↓
7. 管理员点击"批准"
   ↓
8. Gateway 允许设备连接
   ↓
9. 设备现在可以自由连接（已配对状态）
```

### 代码位置

| 组件 | 文件 | 行号 |
|-----|------|------|
| DM Policy 类型定义 | `src/types.ts` | 25, 27 |
| DM Policy 配置 | `start-moltbot.sh` | 186-201 |
| 设备管理 API | `src/routes/api.ts` | 26-173 |
| DEV_MODE 映射 | `src/gateway/env.ts` | 50 |
| allowInsecureAuth 设置 | `start-moltbot.sh` | 179-183 |
| 安全文档 | `docs/security/device-pairing.md` | 全文 |

---

## 架构图

### 完整认证流程图

#### 生产环境（三层认证）

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户请求                                  │
│                  https://worker.example.com/                     │
└────────────────────────┬────────────────────────────────────────┘
                         ↓
                  ┌──────────────┐
                  │ 公开路由？    │
                  └──┬───────┬───┘
                 Yes ↓       ↓ No
          ┌────────────┐     │
          │ 直接处理    │     │
          │ 健康检查等  │     │
          └────────────┘     │
                             ↓
                      ┌─────────────┐
                      │ DEV_MODE?   │
                      └──┬──────┬───┘
                    Yes  ↓      ↓ No
              ┌──────────────┐  │
              │ 跳过所有认证  │  │
              └──────────────┘  │
                                │
          ┌─────────────────────┘
          │
          ↓
┌────────────────────────────────────────────────────────────────┐
│              【Layer 1: Cloudflare Access】                     │
│                    (Worker Middleware)                          │
│                                                                 │
│  1. 从请求中提取 JWT                                            │
│     - CF-Access-JWT-Assertion header                           │
│     - CF_Authorization cookie                                  │
│                                                                 │
│  2. 验证 JWT                                                    │
│     - 从 https://{teamDomain}/cdn-cgi/access/certs 获取 JWKS  │
│     - 验证签名、issuer、audience、过期时间                      │
│                                                                 │
│  3. 提取用户信息                                                │
│     - email, name, sub                                         │
│     - 存储到 c.set('accessUser', ...)                          │
│                                                                 │
│  ❌ 失败 → 401 或重定向到登录页                                 │
│  ✅ 成功 → 继续                                                 │
└────────────────────────────┬───────────────────────────────────┘
                             ↓
┌────────────────────────────────────────────────────────────────┐
│              【Gateway Proxy】                                  │
│               (Worker → Container)                              │
│                                                                 │
│  - 确保 Gateway 进程运行                                        │
│  - WebSocket 升级或 HTTP 代理                                   │
│  - 转发到 localhost:18789                                       │
│                                                                 │
│  ⚠️  注意：Worker 不在这里验证或转发 CLAWDBOT_GATEWAY_TOKEN     │
└────────────────────────────┬───────────────────────────────────┘
                             ↓
┌────────────────────────────────────────────────────────────────┐
│              【Layer 2: Gateway Token】                         │
│             (Container: Gateway Process)                        │
│                                                                 │
│  Gateway 启动命令:                                              │
│  clawdbot gateway --token "$CLAWDBOT_GATEWAY_TOKEN"           │
│                                                                 │
│  1. 检查 URL 中的 ?token=xxx 参数                               │
│  2. 与启动时配置的 token 比对                                   │
│                                                                 │
│  ❌ 失败 → "gateway token missing/mismatch"                     │
│  ✅ 成功 → 继续                                                 │
└────────────────────────────┬───────────────────────────────────┘
                             ↓
┌────────────────────────────────────────────────────────────────┐
│              【Layer 3: Device Pairing】                        │
│              (Gateway Internal Check)                           │
│                                                                 │
│  1. 检查设备是否已配对                                          │
│  2. 如果未配对:                                                 │
│     - 创建配对请求（pending）                                   │
│     - 等待管理员批准                                            │
│                                                                 │
│  管理员操作:                                                    │
│     - 访问 https://worker/_admin/devices                       │
│     - 查看待批准设备（IP、平台、时间）                          │
│     - 点击"批准"按钮                                            │
│                                                                 │
│  ❌ 未批准 → "pairing required"                                │
│  ✅ 已批准 → 允许连接                                           │
└────────────────────────────┬───────────────────────────────────┘
                             ↓
                    ┌────────────────┐
                    │  连接成功！     │
                    │  Agent 运行     │
                    └────────────────┘
```

#### 开发环境（DEV_MODE=true）

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户请求                                  │
│                  http://localhost:8787/                          │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                      ┌─────────────┐
                      │ DEV_MODE?   │
                      └──────┬──────┘
                             ↓ Yes
          ┌──────────────────────────────────┐
          │ 跳过 CF Access 中间件             │
          │ 设置虚拟用户:                     │
          │ { email: 'dev@localhost',         │
          │   name: 'Dev User' }              │
          └──────────────┬───────────────────┘
                         ↓
          ┌──────────────────────────────────┐
          │ 代理到 Gateway (localhost:18789)  │
          └──────────────┬───────────────────┘
                         ↓
          ┌───────────────────────────────────────┐
          │ Gateway 配置:                          │
          │ allowInsecureAuth = true               │
          │                                        │
          │ ✅ 跳过 Token 验证                      │
          │ ✅ 跳过设备配对                         │
          └──────────────┬────────────────────────┘
                         ↓
                ┌────────────────┐
                │  直接连接成功！ │
                └────────────────┘
```

### 环境变量决策表

| 环境变量 | 生产环境 | 开发环境 | 用途 |
|---------|---------|---------|------|
| `CLAWDBOT_GATEWAY_TOKEN` | ✅ 必需 | ❌ 可选 | Gateway Token 验证 |
| `CF_ACCESS_TEAM_DOMAIN` | ✅ 必需 | ❌ 可选 | CF Access JWT issuer |
| `CF_ACCESS_AUD` | ✅ 必需 | ❌ 可选 | CF Access audience 验证 |
| `DEV_MODE` | ❌ 不设置 | ✅ =true | 跳过所有认证 |
| `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY` | ✅ 必需 | ✅ 必需 | AI 服务 |
| `TELEGRAM_DM_POLICY` | ⚪ =pairing | ⚪ =pairing | Telegram 配对策略 |
| `DISCORD_DM_POLICY` | ⚪ =pairing | ⚪ =pairing | Discord 配对策略 |

### 数据流对比

#### Token 在哪里？

```
Worker 环境变量: CLAWDBOT_GATEWAY_TOKEN=xxx
         ↓ (buildEnvVars)
容器环境变量: CLAWDBOT_GATEWAY_TOKEN=xxx
         ↓ (start-moltbot.sh)
Gateway 启动: clawdbot gateway --token xxx
         ↓
Gateway 进程: 验证 ?token=xxx 参数
```

**关键**: Worker **不验证** token，只传递给容器！

#### CF Access JWT 在哪里？

```
用户浏览器: CF_Authorization cookie
         ↓ (HTTP Request)
Worker 中间件: 提取 JWT
         ↓ (verifyAccessJWT)
JWKS 验证: https://{teamDomain}/cdn-cgi/access/certs
         ↓
Worker: 存储 accessUser
         ↓
代理到 Gateway (JWT **不转发**)
```

**关键**: JWT 在 Worker 层验证，**不传递给容器**！

---

## 关键发现

### 核心结论

**用户的困惑来源**: 用户认为 "CLAWDBOT_GATEWAY_TOKEN 被设置时，系统自动运行在 Token 模式，而不是 CF Access 模式"

**真相**:

1. **代码中不存在这样的逻辑**
   - Worker 代码没有检查 CLAWDBOT_GATEWAY_TOKEN 来决定是否跳过 CF Access
   - CF Access 中间件总是应用（除非 DEV_MODE=true）
   - 两者不是互斥关系

2. **当前系统要求同时配置两者**
   ```typescript
   // src/index.ts:55-85
   function validateRequiredEnv(env: MoltbotEnv): string[] {
     const missing: string[] = [];

     if (!env.CLAWDBOT_GATEWAY_TOKEN) {
       missing.push('CLAWDBOT_GATEWAY_TOKEN');
     }

     if (!env.CF_ACCESS_TEAM_DOMAIN) {
       missing.push('CF_ACCESS_TEAM_DOMAIN');
     }

     if (!env.CF_ACCESS_AUD) {
       missing.push('CF_ACCESS_AUD');
     }
     // ...
   }
   ```

3. **Token 和 CF Access 在不同层工作**
   - **CF Access**: 在 Worker 层保护路由
   - **Gateway Token**: 在容器层保护 Gateway 端点
   - 它们是**并行**的，不是互斥的

### 设计决策的合理性

#### 为什么需要三层安全？

1. **纵深防御（Defense in Depth）**
   - 单层防御失败时，其他层仍能保护系统
   - 符合安全最佳实践

2. **分层职责**
   - **CF Access**: 身份验证（Who are you?）
   - **Gateway Token**: 来源验证（Are you from authorized Worker?）
   - **Device Pairing**: 设备授权（Is this device approved?）

3. **灵活性**
   - 可以为不同渠道设置不同的 DM policy
   - 开发环境可以用 DEV_MODE 完全绕过

#### 架构优势

✅ **安全性高**
   - 三层防御，任何一层被绕过都有其他层保护
   - 管理员明确控制（设备配对）

✅ **职责分离清晰**
   - Worker: 处理 HTTP/WebSocket 代理 + CF Access
   - Gateway: 运行 Agent + Token 验证 + 设备配对

✅ **开发友好**
   - DEV_MODE 一键跳过所有认证
   - 生产环境强制安全配置

#### 可能的改进点

⚠️ **配置复杂性**
   - 需要配置多个环境变量
   - 用户可能不理解三层的关系
   - **建议**: 改进文档，添加配置向导

⚠️ **Token 传递方式**
   - Token 通过 URL 参数传递（?token=xxx）
   - 在某些场景下可能被记录到日志
   - **建议**: 考虑支持 Authorization header

⚠️ **错误消息**
   - 当前错误消息可能不够清晰
   - Worker 已经有 transformErrorMessage() 函数（src/index.ts:37-47）
   - **建议**: 继续改进用户友好的错误提示

### 回答用户的问题

**问题**: "不懂这个逻辑, CLAWDBOT_GATEWAY_TOKEN 被设置时，系统自动运行在 Token 模式，而不是 CF Access 模式。"

**回答**:

这是一个**误解**。系统**没有**"Token 模式 vs CF Access 模式"的互斥关系。

实际情况：

1. **生产环境同时需要两者**
   - `CLAWDBOT_GATEWAY_TOKEN` - 必需
   - `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD` - 必需
   - 缺少任何一个都会报错

2. **两者在不同层工作**
   - CF Access 在 **Worker 层** 验证用户身份
   - Gateway Token 在 **容器层** 验证请求来源
   - 它们是**并行**的安全层，不是互斥的

3. **唯一的"模式切换"是 DEV_MODE**
   ```
   DEV_MODE=true  → 跳过所有认证（开发用）
   DEV_MODE=false → 启用所有三层认证（生产用）
   ```

4. **为什么这样设计？**
   - **纵深防御**: 多层安全比单层更安全
   - **职责分离**: Worker 处理路由保护，Gateway 处理端点保护
   - **灵活控制**: 设备配对提供细粒度访问控制

如果你想要**只用 Token，不用 CF Access**，需要修改代码：
- 修改 `validateRequiredEnv()` 使 CF Access 变量可选
- 修改中间件逻辑，当 Token 存在时跳过 CF Access
- 但这会**降低安全性**，不推荐

### 代码证据总结

| 声明 | 证据文件 | 行号 |
|-----|---------|------|
| CF Access 总是应用 | `src/index.ts` | 188-197 |
| 没有条件跳过逻辑 | `src/index.ts` | 整个文件 |
| 所有变量都必需 | `src/index.ts` | 55-85 |
| Token 只传递给容器 | `src/gateway/env.ts` | 47-49 |
| Token 在 Gateway 验证 | `start-moltbot.sh` | 288-292 |
| DEV_MODE 跳过所有 | `src/auth/middleware.ts` | 45-49 |
| DEV_MODE 设置 allowInsecureAuth | `start-moltbot.sh` | 179-183 |
