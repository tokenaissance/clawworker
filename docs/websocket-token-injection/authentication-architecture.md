# 认证架构设计分析

## 问题
浏览器端发起请求时不带 token，Worker 注入 token 完成和 Docker 的校验，后续 WSS 连接如果走浏览器和 Docker 的话，客户端没有 token。这样设计是否合理？

## 结论：当前设计是合理的

### 当前架构

```
浏览器 ──WSS──→ Worker ──(自动注入token)──→ Docker Gateway
                  ↑                              ↑
            CF Access 验证                   token 验证
         (用户身份认证)                    (来源验证)
```

**关键点：浏览器永远不直接连接 Docker，所有连接都经过 Worker 代理。**

### 为什么这是合理的设计

#### 1. 分层安全（Defense in Depth）

| 层级 | 位置 | 作用 | 验证内容 |
|------|------|------|----------|
| Layer 1 | Worker | CF Access | 用户身份（Who are you?） |
| Layer 2 | Docker | Gateway Token | 请求来源（Are you from Worker?） |
| Layer 3 | Gateway | 设备配对 | 设备授权（Is this device approved?） |

#### 2. Token 不暴露给客户端

- 浏览器只需要 CF Access 认证（通过 Cloudflare 登录页面）
- Token 是 Worker 和 Docker 之间的"内部密钥"
- 即使浏览器被攻击，攻击者也无法获取 token
- Token 通过 `prepareProxyRequest()` 自动注入到请求 URL

#### 3. 职责分离清晰

- **Worker 职责**：
  - 验证用户身份（CF Access JWT）
  - 代理 HTTP/WebSocket 请求
  - 注入 Gateway Token
  - 转换错误消息

- **Docker Gateway 职责**：
  - 验证请求来源（token 参数）
  - 运行 AI Agent
  - 管理设备配对
  - 处理业务逻辑

#### 4. 安全优势

1. **攻击面最小化**：Docker 不直接暴露给公网
2. **凭证隔离**：用户凭证（CF Access）和内部凭证（token）分离
3. **审计追踪**：所有请求都经过 Worker，便于日志记录
4. **灵活控制**：可以在 Worker 层实现限流、黑名单等

### 代码实现位置

| 功能 | 文件 | 关键代码 |
|------|------|----------|
| Token 注入 | `src/gateway/injection.ts:273-309` | `prepareProxyRequest()` |
| WSS 代理 | `src/index.ts:276-408` | WebSocket 拦截和转发 |
| CF Access 验证 | `src/auth/middleware.ts:41-125` | `createAccessMiddleware()` |
| Token 传递给容器 | `src/gateway/env.ts:47-49` | `buildEnvVars()` |

## 总结

当前设计遵循了安全最佳实践：
- ✅ 纵深防御（多层安全）
- ✅ 最小权限原则（浏览器不需要知道 token）
- ✅ 职责分离（Worker 处理认证，Gateway 处理业务）
- ✅ 凭证隔离（用户凭证和内部凭证分离）

**架构设计是正确的，问题在于实现细节。**
