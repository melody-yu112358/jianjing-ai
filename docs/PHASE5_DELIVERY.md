# Phase 5 — Roadshow AI Explainability Integration 交付记录

- GitHub认证账号：`melody-yu112358`（提交前已重新核验）。
- 分支：`feature/roadshow-explainability-integration`。
- 开始时origin/main：`5e29d73584d7b0c9cd917340e2f9e5f24aef78ac`。
- 创建PR前再次fetch main，SHA未变化，无需rebase/merge；队友双层光丝与60秒回放均在base中。
- 本阶段不修改main、不自动合并PR、不部署线上站点。

## 验证结果

| 检查 | 结果 |
|---|---|
| 完整Python：`.venv/bin/python -m pytest -q` | **200 passed**，28.09秒；2条第三方弃用警告 |
| 完整frontend：`node --experimental-strip-types --test tests/*.test.ts` | **42 passed**，0 failed |
| TypeScript：`node node_modules/typescript/bin/tsc --noEmit` | 通过，exit 0 |
| Production build：现有Sites build包装器 → `node scripts/run-framework.mjs build` | 通过，exit 0；包含 `/` 与 `/lab` |
| Git diff whitespace | 通过 |
| 浏览器点击、声音、WebGL、投屏/移动布局 | **尚未验证**，云端预览服务不可用 |
| 线上WSS/CORS、真实外部LLM、硬件 | **尚未验证**；provider测试使用可控HTTP transport |

构建保留既有大chunk提示与Vinext静态路由分类提示。未为消除提示而修改无关依赖或队友视觉。

## 已实现

只读Explainability v1及schema；真实State与RitualDecision投影；实际来源rule/mock_llm/llm及fallback；初始方案和有界决策历史；reset与不适立即退出的解释记录；四种自述、体验前总览、统一解释展示；会话/时间/控制一致性校验；完整默认60秒回放节点；原有视觉、音频、手动模式、lab、WebSocket协议及可插拔传感层保留。

后端API不额外采样或调用Controller。最近7次参考始终标记为模拟历史。真实后端没有的解释不从演示数据补齐。

## 仍属DEMO FIXTURE

7次历史及46%/67%均值、HR/respiration个人参考带、60秒连续轨迹、回放分类及理由、回放短路径与固定时间节点。DEMO不调用LLM；confidence显示未计算；decision_source为null。

## 变更文件

- `backend/explainability.py`
- `backend/llm/controller.py`
- `backend/main.py`
- `backend/session.py`
- `docs/EXPLAINABILITY_INTERFACE.md`
- `docs/explainability.schema.json`
- `docs/explainability.example.json`
- `docs/PHASE5_DELIVERY.md`
- `frontend/app/globals.css`
- `frontend/app/page.tsx`
- `frontend/components/roadshow-insights.tsx`
- `frontend/components/use-demo-audio.ts`
- `frontend/components/use-explainability.ts`
- `frontend/docs/ROADSHOW_DEMO.md`
- `frontend/lib/explainability.ts`
- `frontend/lib/roadshow-demo.ts`
- `frontend/lib/roadshow-explainability.ts`
- `frontend/scripts/build-verified.sh`（仅执行权限）
- `frontend/scripts/install-pnpm.sh`（仅执行权限）
- `frontend/scripts/sites-env.sh`（仅执行权限）
- `frontend/tests/explainability-render.test.ts`
- `frontend/tests/explainability.test.ts`
- `tests/test_explainability.py`

## 示例、时间线与数据流

完整真实后端JSON：[explainability.example.json](explainability.example.json)。精确schema：[explainability.schema.json](explainability.schema.json)。字段及数据流图：[EXPLAINABILITY_INTERFACE.md](EXPLAINABILITY_INTERFACE.md)。

完整60秒时间线与状态变体：[ROADSHOW_DEMO.md](../frontend/docs/ROADSHOW_DEMO.md)。默认：0观察 → 8短路径 → 10–20慢呼气 → 20–22重新观察 → 22声音关注 → 38减少提示 → 50跳过额外练习 → 54淡出 → 60结束。

## 余下路演工作

1. 人工review/merge，并在真实浏览器与投屏尺寸完成四种状态、暂停恢复、重播、文案可读性及声音验收。
2. 配好路演后端WSS与前端origin的CORS，验证实时解释、断线重连和跨会话reset。
3. 若展示外部模型，配置Provider并实测成功/超时回退；否则明确展示规则执行或模拟回放。
4. 彩排60秒讲解，准备断网时本地DEMO备用；不把模拟数据称为临床结果。

正式历史库、多用户隔离、PPG优化和Apple Watch实测为未来开发，不是本次路演整合的完成声明。
