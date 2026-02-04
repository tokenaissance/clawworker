# Sandbox 环境隔离实现

## 概述

本文档描述了 Sandbox Durable Object 的环境隔离实现，确保开发环境和生产环境使用完全独立的容器实例。

## 实现动机

### 问题背景

在实现 R2 存储环境隔离后，虽然数据通过不同的 R2 路径实现了隔离（`/data/moltbot-production` vs `/data/moltbot-development`），但所有环境仍然共享同一个 Sandbox Durable Object 实例（标识符为 `'moltbot'`）。

这种设计存在以下问题：

1. **状态污染风险** - 不同环境的容器状态可能相互影响
2. **资源竞争** - 开发和生产环境共享容器资源
3. **监控困难** - 无法在 Cloudflare Dashboard 中区分环境
4. **不一致性** - 与 R2 的环境隔离模式不匹配

### 解决方案

通过为每个环境创建独立的 Sandbox Durable Object 实例，实现完全的环境隔离。

## 设计原则

### 命名模式一致性

保持与 R2 存储相同的命名模式：

| 资源类型 | 函数名 | Development | Production | Default (无环境) |
|---------|--------|-------------|------------|-----------------|
| R2 Bucket | `getR2BucketName()` | `moltbot-data-development` | `moltbot-data-production` | `moltbot-data` |
| R2 Mount Path | `getR2MountPath()` | `/data/moltbot-development` | `/data/moltbot-production` | `/data/moltbot` |
| Sandbox Instance | `getSandboxInstanceId()` | `moltbot-development` | `moltbot-production` | `moltbot` |

### 向后兼容性

当 `ENVIRONMENT` 环境变量未设置时，自动回退到默认标识符 `'moltbot'`，确保向后兼容。

## 实现细节

### 1. 配置函数 (`src/config.ts`)

新增 `getSandboxInstanceId()` 函数：

```typescript
/**
 * Get Sandbox Durable Object instance identifier based on environment
 * This ensures development and production use completely separate container instances
 *
 * @param environment - Environment name from ENVIRONMENT variable
 * @returns Instance identifier (e.g., "moltbot-production", "moltbot-development")
 *
 * @example
 * getSandboxInstanceId('production')  // → "moltbot-production"
 * getSandboxInstanceId('development') // → "moltbot-development"
 * getSandboxInstanceId(undefined)     // → "moltbot" (legacy/default)
 */
export function getSandboxInstanceId(environment?: string): string {
  if (!environment) {
    return 'moltbot';  // Backward compatibility
  }
  return `moltbot-${environment}`;
}
```

### 2. 请求中间件 (`src/index.ts`)

更新 Sandbox 初始化逻辑：

```typescript
// 修改前
app.use('*', async (c, next) => {
  const options = buildSandboxOptions(c.env);
  const sandbox = getSandbox(c.env.Sandbox, 'moltbot', options);  // 固定标识符
  c.set('sandbox', sandbox);
  await next();
});

// 修改后
app.use('*', async (c, next) => {
  const options = buildSandboxOptions(c.env);
  const instanceId = getSandboxInstanceId(c.env.ENVIRONMENT);  // 环境特定标识符
  const sandbox = getSandbox(c.env.Sandbox, instanceId, options);
  c.set('sandbox', sandbox);
  await next();
});
```

### 3. 定时任务处理器 (`src/index.ts`)

更新 Cron 任务的 Sandbox 初始化：

```typescript
// 修改前
async function scheduled(...) {
  const options = buildSandboxOptions(env);
  const sandbox = getSandbox(env.Sandbox, 'moltbot', options);  // 固定标识符

  console.log('[cron] Starting backup sync to R2...');
  // ...
}

// 修改后
async function scheduled(...) {
  const options = buildSandboxOptions(env);
  const instanceId = getSandboxInstanceId(env.ENVIRONMENT);  // 环境特定标识符
  const sandbox = getSandbox(env.Sandbox, instanceId, options);

  console.log(`[cron] Starting backup sync to R2 for ${env.ENVIRONMENT || 'default'} environment...`);
  // ...
}
```

### 4. 导入语句更新

在 `src/index.ts` 中添加新函数的导入：

```typescript
import { MOLTBOT_PORT, getSandboxInstanceId } from './config';
```

## 架构图

### 修改前（共享实例）

```
┌─────────────────────────────────────┐
│ Development Environment             │
│ ENVIRONMENT="development"           │
└─────────────────┬───────────────────┘
                  │
                  ├─→ getSandbox(env.Sandbox, 'moltbot')
                  │
┌─────────────────▼───────────────────┐
│ Sandbox Durable Object: 'moltbot'  │ ← 共享同一实例
│ (Shared Container Instance)         │
└─────────────────┬───────────────────┘
                  │
      ┌───────────┴───────────┐
      │                       │
      ▼                       ▼
  /data/moltbot-development   /data/moltbot-production
  (R2 隔离)                   (R2 隔离)
      ▲                       ▲
      │                       │
      │                       │
┌─────┴───────────────────────┴───────┐
│ Production Environment              │
│ ENVIRONMENT="production"            │
└─────────────────────────────────────┘
```

**问题：** 虽然 R2 路径隔离，但容器实例共享。

### 修改后（完全隔离）

```
┌─────────────────────────────────────┐
│ Development Environment             │
│ ENVIRONMENT="development"           │
└─────────────────┬───────────────────┘
                  │
                  ├─→ getSandboxInstanceId('development')
                  │   → 'moltbot-development'
                  │
                  ├─→ getSandbox(env.Sandbox, 'moltbot-development')
                  │
┌─────────────────▼───────────────────┐
│ Sandbox DO: 'moltbot-development'  │
│ (独立容器实例)                      │
└─────────────────┬───────────────────┘
                  │
                  ▼
          /data/moltbot-development
          (R2 隔离)

─────────────────────────────────────────

┌─────────────────────────────────────┐
│ Production Environment              │
│ ENVIRONMENT="production"            │
└─────────────────┬───────────────────┘
                  │
                  ├─→ getSandboxInstanceId('production')
                  │   → 'moltbot-production'
                  │
                  ├─→ getSandbox(env.Sandbox, 'moltbot-production')
                  │
┌─────────────────▼───────────────────┐
│ Sandbox DO: 'moltbot-production'   │
│ (独立容器实例)                      │
└─────────────────┬───────────────────┘
                  │
                  ▼
          /data/moltbot-production
          (R2 隔离)
```

**结果：** 完全独立的容器实例和数据隔离。

## 优势

1. **完全隔离** - 每个环境有独立的 Durable Object 实例和容器
2. **避免资源竞争** - 开发和生产环境不共享容器资源
3. **状态独立** - 不存在跨环境的状态污染风险
4. **易于监控** - 在 Cloudflare Dashboard 中可清晰看到不同环境的实例
5. **命名一致** - 与 R2 存储桶命名模式保持一致
6. **向后兼容** - 无 `ENVIRONMENT` 变量时自动使用默认值

## 部署验证

### 验证步骤

1. **构建检查**
   ```bash
   npm run build
   ```
   确保 TypeScript 编译通过。

2. **部署到开发环境**
   ```bash
   npm run deploy:dev
   wrangler tail --env development
   ```

   预期日志：
   ```
   [Sandbox] Using instance ID: moltbot-development
   Mounting R2 bucket "moltbot-data-development"
   [cron] Starting backup sync to R2 for development environment...
   ```

3. **部署到生产环境**
   ```bash
   npm run deploy:prod
   wrangler tail --env production
   ```

   预期日志：
   ```
   [Sandbox] Using instance ID: moltbot-production
   Mounting R2 bucket "moltbot-data-production"
   [cron] Starting backup sync to R2 for production environment...
   ```

4. **Cloudflare Dashboard 检查**

   访问 Cloudflare Dashboard → Workers & Pages → Durable Objects

   应该看到：
   - `moltbot-development` (Development 环境专用)
   - `moltbot-production` (Production 环境专用)
   - `moltbot` (旧实例，逐渐不再使用)

### 环境隔离测试

1. 在开发环境配对一个测试设备
2. 检查生产环境 - 应该看不到该设备
3. 验证两个环境的日志显示不同的实例 ID

## 迁移说明

### Durable Object 实例迁移

部署新代码后：

1. **新实例创建** - 系统会自动创建 `moltbot-{environment}` 新实例
2. **旧实例保留** - 原有的 `'moltbot'` 实例会保留但不再使用
3. **数据恢复** - 新实例启动时会自动从 R2 恢复数据（如果有备份）

### 冷启动说明

首次部署后：
- 新的 Durable Object 实例需要初始化
- 容器首次启动可能需要 30-60 秒
- 建议在低流量时段部署

### 回滚方案

如需回滚：
```bash
git revert <commit-hash>
npm run deploy:prod
```

回滚后会自动使用旧的 `'moltbot'` 实例。

## 监控和日志

### 关键日志指标

**成功部署标志：**
```
✅ Using instance ID: moltbot-{environment}
✅ Mounting R2 bucket "moltbot-data-{environment}"
✅ Using environment-specific backup directory: /data/moltbot-{environment}
✅ Restored config from R2 backup
```

**需要关注的错误：**
```
❌ Failed to initialize Sandbox
❌ R2 bucket mount failed
❌ Backup restore failed
```

### 性能监控

在 Cloudflare Dashboard 中监控：
- Durable Object 请求量
- 容器启动时间
- R2 读写操作
- Cron 任务执行状态

## 代码修改总结

| 文件 | 修改内容 | 代码行数 |
|------|---------|---------|
| `src/config.ts` | 添加 `getSandboxInstanceId()` 函数 | +15 行 |
| `src/index.ts` | 更新导入语句 | +1 行 |
| `src/index.ts` | 更新中间件 Sandbox 初始化 | +2 行（修改） |
| `src/index.ts` | 更新 Cron Sandbox 初始化 | +2 行（修改） |
| **总计** | | **~20 行** |

## 相关文档

- [R2 环境隔离](./r2-environment-isolation.md) - R2 存储的环境隔离实现
- [参数注入安全](./parameter-injection.md) - 网关参数注入安全措施
- [架构说明](./architecture_explanation.md) - 整体架构设计

## 版本历史

- **v1.0** (2026-02-04) - 初始实现
  - 添加 `getSandboxInstanceId()` 配置函数
  - 更新请求中间件和定时任务处理器
  - 实现完全的环境隔离
