# 架构说明：自动注入 Gateway Token 实现方案

## 目标
用中文详细解释 Worker 和 Gateway 的角色，以及 token 在网络通信中的注入时机。

---

## 1. 架构组件说明

### Worker (Cloudflare Worker)
**位置**: 运行在 Cloudflare 边缘网络上的 JavaScript 代码
**文件**: `src/index.ts`

**作用**:
- **代理/反向代理角色**: 接收来自互联网的 HTTPS 请求
- **第一层安全**: 通过 Cloudflare Access 验证用户身份（JWT cookie）
- **请求转发**: 将请求转发给 Cloudflare Sandbox 容器中的 Gateway
- **Token 注入点**: 在这里实施 token 注入（本次实现的核心）

### Gateway (Moltbot Gateway)
**位置**: 运行在 Cloudflare Sandbox 容器内的 Node.js 应用
**端口**: 容器内部的 8787 端口

**作用**:
- **第二层安全**: 验证请求 URL 中的 `?token=xxx` 参数
- **第三层安全**: 验证设备配对状态（device pairing）
- **核心服务**: 提供 Web UI、WebSocket、Admin 界面等功能

---

## 2. 网络通信流程和 Token 注入时机

### 完整请求流程图

```
用户浏览器
    ↓
    │ HTTPS 请求
    │ https://paramita-cloud-development.sakurainlab.workers.dev/
    ↓
┌─────────────────────────────────────────────────┐
│  Cloudflare Worker (边缘网络)                     │
│  src/index.ts                                   │
│                                                 │
│  Step 1: CF Access 中间件                        │
│  ├─ 检查 CF-Access-JWT-Assertion cookie        │
│  ├─ 验证用户身份 (第一层安全 ✓)                   │
│  └─ 通过 → 继续；失败 → 返回 403                 │
│                                                 │
│  Step 2: Token 注入 【本次实现的核心】             │
│  ├─ 读取环境变量 CLAWDBOT_GATEWAY_TOKEN         │
│  ├─ 调用 injectGatewayToken(url, token)        │
│  ├─ 原 URL: /?foo=bar                          │
│  └─ 新 URL: /?foo=bar&token=secret123          │
│                                                 │
│  Step 3: 创建新请求                              │
│  ├─ 使用注入 token 后的 URL                     │
│  └─ 转发给容器                                  │
│                                                 │
└─────────────────────────────────────────────────┘
    ↓
    │ 内部请求 (Worker → Container)
    │ http://localhost:8787/?foo=bar&token=secret123
    ↓
┌─────────────────────────────────────────────────┐
│  Cloudflare Sandbox 容器                        │
│  (运行 Moltbot Gateway)                         │
│                                                 │
│  Step 4: Gateway Token 验证                     │
│  ├─ 检查 URL 参数中的 token                     │
│  ├─ 对比环境变量 CLAWDBOT_GATEWAY_TOKEN         │
│  └─ 匹配 → 继续；不匹配 → 返回错误 (第二层安全 ✓) │
│                                                 │
│  Step 5: 设备配对验证                           │
│  ├─ 检查请求来源设备是否已配对                   │
│  └─ 已配对 → 继续；未配对 → 返回错误 (第三层安全 ✓)│
│                                                 │
│  Step 6: 处理业务逻辑                           │
│  └─ 返回 Web UI / 处理 WebSocket / Admin 界面   │
│                                                 │
└─────────────────────────────────────────────────┘
    ↓
    │ HTTP 响应
    ↓
用户浏览器
```

### 关键时机说明

**Token 注入发生在**:
- **阶段**: Worker 接收到请求，通过 CF Access 验证后，转发给容器之前
- **位置**: Worker 代码中（Cloudflare 边缘网络）
- **对用户**: 完全透明，用户看不到 token
- **对 Gateway**: 收到的请求 URL 已经包含 token 参数

**为什么在这里注入**:
1. **安全**: Token 存储在 Worker 环境变量中，不暴露给用户
2. **集中**: 所有请求（HTTP + WebSocket）都在这里统一处理
3. **早期**: 在转发到容器之前注入，Gateway 收到的就是完整请求

---

## 3. 三层安全防护机制

### 纵深防御（Defense in Depth）

```
第一层: Cloudflare Access (Worker 层)
├─ 验证对象: 用户身份
├─ 验证方式: JWT cookie (CF-Access-JWT-Assertion)
├─ 失败结果: 403 Forbidden
└─ 保护范围: 所有需要认证的路由

    ↓ (通过后)

第二层: Gateway Token (容器层)
├─ 验证对象: 请求来源 (是否来自合法的 Worker)
├─ 验证方式: URL 参数 ?token=xxx
├─ 失败结果: WebSocket 1008 断开 / HTTP 401
└─ 保护范围: 所有到达 Gateway 的请求

    ↓ (通过后)

第三层: Device Pairing (Gateway 内部)
├─ 验证对象: 设备是否已授权
├─ 验证方式: 检查设备配对数据库
├─ 失败结果: 提示访问 /_admin/devices
└─ 保护范围: 需要设备授权的操作
```

### 为什么需要三层？

| 安全层 | 防护目的 | 绕过后果 |
|--------|---------|---------|
| CF Access | 防止未授权用户访问 | 任何人都能访问你的 Worker |
| Gateway Token | 防止绕过 Worker 直接访问容器 | 攻击者可以直接攻击容器端口 |
| Device Pairing | 防止多设备滥用 | 一个账号可以在无限设备上使用 |

---

## 4. 本次实现前后对比

### 实现前（问题）

```
用户访问: https://example.com/
    ↓
Worker: 通过 CF Access ✓
    ↓
Worker: 转发 URL = /?     (没有 token)
    ↓
Gateway: 检查 token → 没有! ✗
    ↓
错误: disconnected (1008): Invalid or missing token
```

**用户体验**: 必须手动在 URL 加上 `?token=xxx`

### 实现后（解决）

```
用户访问: https://example.com/
    ↓
Worker: 通过 CF Access ✓
    ↓
Worker: 自动注入 token
        原 URL: /?
        新 URL: /?token=secret123
    ↓
Worker: 转发新 URL 到容器
    ↓
Gateway: 检查 token → 匹配! ✓
    ↓
成功: 正常返回页面/WebSocket
```

**用户体验**: 直接访问 URL，无需手动添加 token

---

## 5. 代码实现位置

### Token 注入工具函数
- **文件**: `src/gateway/utils.ts:33-37`
- **函数**: `injectGatewayToken(url: URL, token: string): URL`
- **作用**: 将 token 添加到 URL 的 query 参数中

### WebSocket 请求注入
- **文件**: `src/index.ts:275-293`
- **位置**: WebSocket 握手请求转发前
- **流程**:
  1. 读取 `c.env.CLAWDBOT_GATEWAY_TOKEN`
  2. 调用 `injectGatewayToken()` 生成新 URL
  3. 创建新 Request 对象
  4. 调用 `sandbox.wsConnect(modifiedRequest)`

### HTTP 请求注入
- **文件**: `src/index.ts:391-411`
- **位置**: HTTP 请求转发前
- **流程**:
  1. 读取 `c.env.CLAWDBOT_GATEWAY_TOKEN`
  2. 调用 `injectGatewayToken()` 生成新 URL
  3. 创建新 Request 对象（包含 body）
  4. 调用 `sandbox.containerFetch(modifiedRequest)`

---

## 6. 安全性分析

### Token 不会泄露给用户

**用户看到的 URL**:
```
https://paramita-cloud-development.sakurainlab.workers.dev/
```

**Worker 转发给容器的 URL**:
```
http://localhost:8787/?token=secret123
```

**原因**: Token 注入发生在 Worker 内部，用户浏览器看不到容器内部的通信。

### Token 存储位置

- **Worker 环境变量**: `CLAWDBOT_GATEWAY_TOKEN`（Wrangler secrets）
- **容器环境变量**: `CLAWDBOT_GATEWAY_TOKEN`（构建时传入）
- **用户浏览器**: 无（完全不知道 token 的存在）

### 向后兼容性

即使用户手动在 URL 添加 token，也能正常工作：

```
用户访问: https://example.com/?token=manual
    ↓
Worker 注入: /?token=manual&token=auto-injected
    ↓
Gateway 验证: 使用第一个 token 值 (manual)
```

但由于 `searchParams.set('token', ...)` 会覆盖已有值，实际行为是：

```
用户访问: https://example.com/?token=manual
    ↓
Worker 注入: /?token=auto-injected  (覆盖)
    ↓
Gateway 验证: 使用 auto-injected
```

---

## 总结

1. **Worker** = 边缘代理，负责 CF Access 和 token 注入
2. **Gateway** = 容器内服务，负责 token 验证和业务逻辑
3. **Token 注入时机** = Worker 通过 CF Access 后，转发请求给容器之前
4. **用户体验** = 完全透明，无需手动添加 token
5. **安全性** = 三层防护全部保留，token 不泄露给用户
