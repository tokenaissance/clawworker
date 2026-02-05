# 任务计划：移除 MOLTBOT_GATEWAY_TOKEN，统一使用 CLAWDBOT_GATEWAY_TOKEN

## 任务目标

完全移除 `MOLTBOT_GATEWAY_TOKEN` 的逻辑，Worker 直接使用 `CLAWDBOT_GATEWAY_TOKEN`。

## 变更范围

### 需要修改的文件
1. `src/types.ts` - 移除 `MOLTBOT_GATEWAY_TOKEN`，保留 `CLAWDBOT_GATEWAY_TOKEN`
2. `src/gateway/env.ts` - 移除映射逻辑，直接传递 `CLAWDBOT_GATEWAY_TOKEN`
3. `src/index.ts` - 验证逻辑只检查 `CLAWDBOT_GATEWAY_TOKEN`
4. `src/gateway/env.test.ts` - 更新测试用例
5. 文档文件 - 更新相关说明

## 待完成任务

### Phase 1: 类型定义 ✅
- [x] 移除 `MOLTBOT_GATEWAY_TOKEN`
- [x] 保留 `CLAWDBOT_GATEWAY_TOKEN`

### Phase 2: 环境变量传递 ✅
- [x] 移除映射逻辑
- [x] 直接传递 `CLAWDBOT_GATEWAY_TOKEN`

### Phase 3: 验证逻辑 ✅
- [x] 只检查 `CLAWDBOT_GATEWAY_TOKEN`

### Phase 4: 测试 ✅
- [x] 更新测试用例
- [x] 运行测试验证 (64 tests passed)

### Phase 5: 文档更新 ✅
- [x] 更新 src/index.ts 注释
- [x] 更新 src/routes/debug.ts
- [x] 更新 wrangler.jsonc
- [x] 更新 package.json
- [x] 更新 .dev.vars.example
- [x] 更新 README.md
- [x] 更新 docs/DEPLOYMENT.md
- [x] 更新 AGENTS.md

## 完成状态: ✅ 全部完成

---

# 历史任务：完善 clawworker 项目的环境配置 ✅

## 任务目标
为 clawworker 项目完善 production 和 development 环境配置，包括：
- ✅ 不同的 R2 bucket（但 secret 名称相同）
- ✅ 不同的 worker 名称
- ✅ 环境变量区分
- ⏳ 不同的路由和域名（可选）
- ✅ Cron 触发器配置

**配置工作完成度: 100%** 🎉
