# ClawBot Sandbox 文档

## 📚 文档目录

### 架构文档
- **[parameter-injection.md](parameter-injection.md)** - URL 参数注入系统
  - 设计原理和架构
  - API 参考和使用示例
  - 类型定义和配置
  - 测试和故障排查
- **[architecture-explanation.md](architecture-explanation.md)** - 架构详细说明（中文）
  - Worker 和 Gateway 的角色
  - 网络通信流程图
  - 三层安全防护机制
  - Token 注入时机说明

### 部署文档
- **[DEPLOYMENT.md](DEPLOYMENT.md)** - 完整的部署指南
  - 环境配置概览
  - 部署命令
  - Secret 配置
  - 故障排查
- **[multi-tenant-deployment.md](multi-tenant-deployment.md)** - 多租户部署指南
  - 动态部署脚本使用
  - 租户隔离架构
  - 命名规则和配置选项
- **[r2-environment-isolation.md](r2-environment-isolation.md)** - R2 存储环境隔离
  - 问题陈述和解决方案
  - 动态挂载路径实现
  - 环境特定命名规范
  - 测试和故障排查

### 安全文档
- **[security/README.md](security/README.md)** - 安全架构概览
- **[security/device-pairing.md](security/device-pairing.md)** - 设备配对机制

### 开发文档
- **[parameter-injection-progress.md](parameter-injection-progress.md)** - 参数注入系统开发进度
  - 实现过程记录
  - 测试结果
  - 关键指标

### 规划文档
以下是环境配置任务的规划文档（位于 `deployment/` 目录）：

- **[task_plan.md](deployment/task_plan.md)** - 任务计划和进度追踪
- **[findings.md](deployment/findings.md)** - 配置分析和发现
- **[progress.md](deployment/progress.md)** - 详细的进度日志

## 🚀 快速开始

1. 查看 [DEPLOYMENT.md](DEPLOYMENT.md) 了解环境配置
2. 阅读 [parameter-injection.md](parameter-injection.md) 了解参数注入系统
3. 查看 [architecture-explanation.md](architecture-explanation.md) 理解整体架构
4. 为每个环境创建独立的 R2 buckets（参考 [r2-environment-isolation.md](r2-environment-isolation.md)）
5. 配置必需的 secrets
6. 执行部署命令

## 🏗️ 架构概览

系统采用三层安全防护：

1. **Cloudflare Access** - Worker 层，验证用户身份
2. **Gateway Token** - 容器层，验证请求来源（自动注入）
3. **Device Pairing** - Gateway 内部，验证设备授权

详见 [architecture-explanation.md](architecture-explanation.md)

## 📖 更多资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
- [R2 存储文档](https://developers.cloudflare.com/r2/)
