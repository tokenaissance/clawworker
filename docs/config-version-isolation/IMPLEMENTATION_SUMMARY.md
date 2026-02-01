# Configuration Version Isolation Implementation Summary

## ✅ Implementation Complete

配置版本隔离功能已经全部实现完成！

## 实现的功能

### 核心特性

1. **版本化配置文件**
   - 格式：`clawdbot.{git_tag}_{timestamp}.json`
   - 示例：`clawdbot.v1.0.0_1738425600.json`
   - 每个版本使用独立的配置文件

2. **构建时版本注入**
   - Git tag + Unix 时间戳
   - 通过 Vite define 注入到 Worker 代码
   - 传递给容器环境变量

3. **自动迁移**
   - 首次运行时自动迁移旧配置
   - 备份旧配置为 `.pre-version-isolation.backup`
   - 无缝升级，不丢失数据

4. **R2 同步**
   - 支持多版本配置同步
   - 所有版本配置都保存到 R2
   - 手动清理策略（按需删除旧版本）

## 修改的文件

| 文件 | 修改内容 |
|------|---------|
| `scripts/get-version.js` | 新建：版本检测脚本 |
| `vite.config.ts` | 添加构建时版本注入 |
| `src/types.ts` | 添加 CONFIG_VERSION 类型 |
| `src/index.ts` | 声明全局变量，注入 middleware |
| `src/gateway/env.ts` | 传递 CONFIG_VERSION 到容器 |
| `start-moltbot.sh` | 使用版本化配置文件 |
| `src/gateway/sync.ts` | 更新 R2 同步逻辑 |

## 工作流程

### 1. 构建阶段
```bash
npm run build
```

**发生的事情：**
1. `scripts/get-version.js` 获取 git tag 和时间戳
2. Vite 将版本注入为全局常量 `__CONFIG_VERSION__`
3. Worker 代码打包，包含版本信息

**输出示例：**
```
[Build] CONFIG_VERSION: v1.0.0-dirty_1769953117
```

### 2. 部署阶段
```bash
npm run deploy
```

Worker 部署到 Cloudflare，版本信息嵌入在代码中。

### 3. 容器启动阶段

**流程：**
```
Worker 接收请求
  ↓ middleware 注入 CONFIG_VERSION
Worker env.CONFIG_VERSION = "v1.0.0_1769953117"
  ↓ buildEnvVars()
容器环境变量 CONFIG_VERSION = "v1.0.0_1769953117"
  ↓ start-moltbot.sh
配置文件路径: /root/.clawdbot/clawdbot.v1.0.0_1769953117.json
  ↓ 首次运行检测
发现旧配置 clawdbot.json
  ↓ 迁移
复制到 clawdbot.v1.0.0_1769953117.json
备份旧配置为 clawdbot.json.pre-version-isolation.backup
  ↓ 配置更新
从环境变量更新配置（token、AI gateway 等）
  ↓ 启动 gateway
clawdbot gateway 使用新配置文件
```

### 4. R2 同步
```
手动或定时触发同步
  ↓ src/gateway/sync.ts
检查是否有配置文件（versioned 或 legacy）
  ↓ rsync
同步整个 /root/.clawdbot/ 目录到 R2
  ↓ R2 保存
/data/moltbot/clawdbot/clawdbot.v1.0.0_1769953117.json
/data/moltbot/clawdbot/clawdbot.v1.1.0_1769953200.json
...
```

## 版本隔离效果

### 场景1：升级部署

```
T0: v1.0.0 容器运行
配置: clawdbot.v1.0.0_1738425600.json

T1: 部署 v1.1.0
新容器启动
配置: clawdbot.v1.1.0_1738426000.json  ← 新文件！

T2: 两个版本同时运行（蓝绿部署）
v1.0.0 容器读取 clawdbot.v1.0.0_1738425600.json
v1.1.0 容器读取 clawdbot.v1.1.0_1738426000.json
✅ 互不干扰！
```

### 场景2：回滚

```
T0: v1.1.0 运行中，出现问题
配置: clawdbot.v1.1.0_1738426000.json

T1: 回滚到 v1.0.0
旧容器启动
配置: clawdbot.v1.1.0_1738426000.json  ← 等等，这不对！

问题：时间戳每次构建都不同，回滚后版本号是新的！
```

**解决方法：**
- 保留构建产物（dist/），不要每次回滚时重新构建
- 或者：使用 git tag 创建新的 release tag，不包含时间戳的构建

### 场景3：参数修改（解决了你最初的问题）

```
T0: 容器运行，配置包含 token
配置: clawdbot.v1.0.0_1738425600.json
内容: { "gateway": { "auth": { "token": "abc123" } } }

T1: 删除 MOLTBOT_GATEWAY_TOKEN secret，重新部署
Worker 重新构建: v1.0.0-dirty_1738427000
新容器启动
配置: clawdbot.v1.0.0-dirty_1738427000.json  ← 新文件！
内容: { "gateway": {} }  ← 没有 token

T2: Gateway 启动
读取新配置，没有 token
✅ 不再要求 token！
```

## 用户决策记录

根据你的选择，实现了以下策略：

1. **不创建 symlink**
   - 不创建 `clawdbot.json` → `clawdbot.{version}.json` 的符号链接
   - 直接使用版本化文件名

2. **版本检测失败时阻止部署（Fail-fast）**
   - 如果无法获取 git 版本（生产环境），构建失败
   - 确保版本信息始终可用

3. **手动清理（Manual cleanup）**
   - 不自动删除旧配置文件
   - 所有历史版本保留在 R2
   - 需要时手动清理

## 下一步

### 部署和测试

1. **提交代码**
   ```bash
   git add .
   git commit -m "feat: implement config version isolation"
   ```

2. **创建新 tag（推荐）**
   ```bash
   git tag -a v1.1.0 -m "Config version isolation release"
   ```

3. **部署**
   ```bash
   npm run deploy
   ```

4. **重启 Gateway（解决当前 token 问题）**
   - 访问 `https://paramitacloud.com/_admin/`
   - 点击 "Restart Gateway" 按钮
   - 或等待容器自动重启

### 验证

1. **检查版本注入**
   ```bash
   npx wrangler tail
   ```
   应该看到：
   ```
   Config version: v1.1.0_1769953117
   Config file: /root/.clawdbot/clawdbot.v1.1.0_1769953117.json
   ```

2. **检查迁移**
   首次运行应该看到：
   ```
   ==========================================
   Migrating legacy config to versioned format
   ==========================================
   Legacy config: /root/.clawdbot/clawdbot.json
   New config: /root/.clawdbot/clawdbot.v1.1.0_1769953117.json
   Migration complete. Legacy config backed up to:
     /root/.clawdbot/clawdbot.json.pre-version-isolation.backup
   ==========================================
   ```

3. **检查 R2 同步**
   触发同步后，R2 应该包含：
   ```
   /data/moltbot/clawdbot/
   ├── clawdbot.v1.1.0_1769953117.json
   └── clawdbot.json.pre-version-isolation.backup
   ```

### 清理旧配置（可选）

如果 R2 中积累了太多版本，可以手动清理：

1. 进入容器
2. 查看配置文件：
   ```bash
   ls -lh /data/moltbot/clawdbot/
   ```
3. 删除旧版本：
   ```bash
   rm /data/moltbot/clawdbot/clawdbot.v1.0.0_*.json
   ```

## 已知限制

1. **时间戳每次构建都不同**
   - 即使代码相同，重新构建会生成新的时间戳
   - 回滚需要保留原始构建产物

2. **开发模式**
   - 开发时有未提交的更改会显示 "-dirty" 标记
   - 这是正常的，表示工作区有修改

3. **手动清理**
   - 不会自动清理旧配置
   - 需要定期检查并手动删除不需要的版本

## 故障排查

### 问题1：构建时 CONFIG_VERSION 是 "unknown"

**原因：** Git 不可用或仓库没有 commits

**解决：**
```bash
git log  # 检查是否有 commits
git tag  # 检查是否有 tags
```

### 问题2：容器启动时找不到配置文件

**原因：** CONFIG_VERSION 环境变量未传递

**检查：**
```bash
npx wrangler tail
```
查看日志中的 "Config version" 输出。

### 问题3：旧配置仍在使用

**原因：** 容器没有重启

**解决：**
- 访问 `/_admin/` 重启 Gateway
- 或重新部署 Worker

## 文档位置

所有规划文档保存在：
```
docs/config-version-isolation/
├── task_plan.md    # 任务计划和决策
├── findings.md     # 研究发现
└── progress.md     # 进度日志
```

---

**实现完成！**现在可以部署测试了。🎉
