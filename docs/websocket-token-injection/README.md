# WebSocket Token 注入问题调查

## 问题描述

浏览器端发起 WebSocket 请求时不带 token，Worker 应该自动注入 token 完成和 Docker Gateway 的校验。但实际测试中，WebSocket 连接报 "gateway token missing" 错误。

## 当前状态

### 已确认

1. **Worker 端 `prepareProxyRequest()` 正确注入了 token**
   ```
   [WS] Proxied URL search: ?token=84de9696e2aa923f5983e2e095d55bb735593cad3eb01ab84d0f82c2e617f238
   [WS] Proxied URL searchParams: 84de9696e2aa923f5983e2e095d55bb735593cad3eb01ab84d0f82c2e617f238
   ```

2. **问题发生在 `wsConnect` 之后的某个环节**

### 待确认

- 容器端实际收到的请求 URL 是什么
- `switchPort` 函数是否正确传递了 URL

## 技术分析

### 架构流程

```
浏览器 ──WSS──→ Worker ──(注入token)──→ wsConnect ──→ switchPort ──→ stub.fetch ──→ Container
                  ↑                                                                    ↑
            已确认 token 注入成功                                              需要确认收到的 URL
```

### `@cloudflare/sandbox` 的 `wsConnect` 实现

```javascript
// @cloudflare/sandbox/dist/index.js
function connect(stub) {
    return async (request, port) => {
        if (!validatePort(port)) throw new SecurityError(...);
        const portSwitchedRequest = switchPort(request, port);
        return await stub.fetch(portSwitchedRequest);
    };
}
```

### `@cloudflare/containers` 的 `switchPort` 实现

```javascript
// @cloudflare/containers/dist/lib/utils.js
export function switchPort(request, port) {
    const headers = new Headers(request.headers);
    headers.set('cf-container-target-port', port.toString());
    return new Request(request, { headers });
}
```

**关键点**：`switchPort` 使用 `new Request(request, { headers })`，URL 应该从第一个参数 `request` 继承。

### HTTP/2 `:path` 伪头部

- HTTP/2 的 `:path` 伪头部是只读的，无法直接修改
- 但 `:path` 是从 URL 自动派生的
- 当使用 `new Request(url, request)` 时，`:path` 会从第一个参数（URL）生成
- 查询参数会自动包含在 `:path` 中

## 浏览器请求对比

### 带 token 的请求（成功）
```
GET wss://paramita-cloud-development.sakurainlab.workers.dev/ HTTP/1.1
Host: paramita-cloud-development.sakurainlab.workers.dev
Connection: Upgrade
Upgrade: websocket
...
```

### 不带 token 的请求（失败）
```
GET wss://paramita-cloud-development.sakurainlab.workers.dev/ HTTP/1.1
Host: paramita-cloud-development.sakurainlab.workers.dev
Connection: Upgrade
Upgrade: websocket
...
```

**观察**：两个请求几乎完全相同，URL 都是 `/` 没有查询参数。这说明前端代码在创建 WebSocket 连接时没有从 `window.location.search` 获取参数。

## 尝试过的方案

### 方案 1：使用 `new Request(url, request)` 继承属性

```typescript
// src/gateway/injection.ts
const modifiedRequest = new Request(injectionResult.url.toString(), request);
```

**结果**：Worker 日志显示 token 已注入，但容器仍报错。

### 方案 2：使用内部 URL `http://0.0.0.0`（已撤销）

```typescript
const internalUrl = `http://0.0.0.0${pathAndSearch}`;
const modifiedRequest = new Request(internalUrl, request);
```

**结果**：未测试，已撤销。

## 下一步调查方向

1. **查看容器端日志**：确认容器实际收到的请求 URL
2. **在容器内添加日志**：在 Gateway 的 WebSocket 处理入口打印请求 URL
3. **测试 HTTP 请求**：确认 HTTP 请求是否能正确收到 token
4. **检查 `stub.fetch` 行为**：可能需要深入 Cloudflare 内部实现

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/gateway/injection.ts` | 参数注入实现 |
| `src/gateway/injection.test.ts` | 26 个测试用例 |
| `src/index.ts:276-408` | WebSocket 代理处理 |
| `node_modules/@cloudflare/sandbox/dist/index.js` | wsConnect 实现 |
| `node_modules/@cloudflare/containers/dist/lib/utils.js` | switchPort 实现 |

## 参考资料

- [Cloudflare Containers 文档](https://developers.cloudflare.com/containers/)
- [HTTP/2 伪头部规范](https://httpwg.org/specs/rfc7540.html#HttpRequest)
