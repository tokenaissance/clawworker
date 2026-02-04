# `@cloudflare/sandbox` 源码分析

## wsConnect 实现

位置：`node_modules/@cloudflare/sandbox/dist/index.js`

```javascript
// 导入 switchPort 函数
import { Container, getContainer, switchPort } from "@cloudflare/containers";

// wsConnect 的实际实现
function connect(stub) {
    return async (request, port) => {
        if (!validatePort(port))
            throw new SecurityError(`Invalid or restricted port: ${port}. Ports must be in range 1024-65535 and not reserved.`);
        const portSwitchedRequest = switchPort(request, port);
        return await stub.fetch(portSwitchedRequest);
    };
}

// getSandbox 返回的对象包含 wsConnect
export function getSandbox(binding, name, options) {
    // ...
    return Object.assign(stub, { wsConnect: connect(stub) });
}
```

## switchPort 实现

位置：`node_modules/@cloudflare/containers/dist/lib/utils.js`

```javascript
/**
 * Return a request with the port target set correctly
 * You can use this method when you have to use `fetch` and not `containerFetch`
 * as it's a JSRPC method and it comes with some consequences like not being
 * able to pass WebSockets.
 *
 * @example container.fetch(switchPort(request, 8090));
 */
export function switchPort(request, port) {
    const headers = new Headers(request.headers);
    headers.set('cf-container-target-port', port.toString());
    return new Request(request, { headers });
}
```

## 关键分析

### Request 构造函数行为

`new Request(request, { headers })` 的行为：
- 第一个参数 `request` 提供：URL、method、body 等
- 第二个参数 `{ headers }` 只覆盖 headers

**理论上 URL 应该被正确继承。**

### 调用链

```
Worker 代码
    ↓
prepareProxyRequest() → 创建带 token 的 modifiedRequest
    ↓
sandbox.wsConnect(modifiedRequest, MOLTBOT_PORT)
    ↓
connect(stub)(modifiedRequest, port)
    ↓
switchPort(modifiedRequest, port) → 创建 portSwitchedRequest
    ↓
stub.fetch(portSwitchedRequest) → 发送到容器
```

### 可能的问题点

1. **`new Request(request, { headers })` 的 URL 继承**
   - 需要验证 URL 是否真的被继承

2. **`stub.fetch` 的内部实现**
   - 可能有额外的 URL 处理逻辑

3. **Cloudflare 内部路由**
   - 可能在 `cf-container-target-port` header 处理时修改了 URL

## 类型定义

位置：`node_modules/@cloudflare/sandbox/dist/sandbox-CEsJ1edi.d.ts`

```typescript
interface ISandbox {
    // ... 其他方法
    wsConnect(request: Request, port: number): Promise<Response>;
}
```

## 相关代码位置

| 文件 | 行号 | 内容 |
|------|------|------|
| `@cloudflare/sandbox/dist/index.js` | 2566-2573 | wsConnect 实现 |
| `@cloudflare/containers/dist/lib/utils.js` | 44-48 | switchPort 实现 |
| `@cloudflare/containers/dist/lib/utils.d.ts` | 24-31 | switchPort 类型定义 |
