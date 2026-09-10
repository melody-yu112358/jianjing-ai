# 渐静 · 柔性状态球

React + Three.js 前端：柔性球面（涟漪 / 褶皱 / 湍动 / 平静 / 脉动）+ 粒子 + 流线。每种模式拥有连续强度与精细参数，模式间平滑混合。

后端 Agent 提供引导词和动画控制，前端校验并呈现。支持现有 v1.0 消息及新的 v2.0 协议。人工调节只接管动画，保留实时 Agent 引导。

- [后端接口契约、参数表与联调示例](docs/AGENT_INTERFACE.md)
- [初版调研](docs/RESEARCH.md)
- [JSON Schema](public/agent-control.schema.json)

本地使用 Node 22.13+ 与项目指定 pnpm。`pnpm dev` 开发，`pnpm build` 构建。协议测试：`node --experimental-strip-types --test tests/agent-control.test.ts`。

模拟 Agent：`python examples/agent_mock.py`（需要 websockets），本地前端连接 `ws://127.0.0.1:8765/ws/control`。线上 HTTPS 页面需要可访问的 WSS 服务。

默认合成演示不代表真实生理改善。该项目独立保存，不修改原后端仓库。

网页 v3：97,792 三角面的柔缎珠光球；内置 40 秒时间戳 Agent 回放。第 34 秒模拟入睡，触发一次 `jianjing:sleep-detected` 事件，并用 6 秒收拢淡出。后端通过可选 `payload.events` 报告入睡，详见接口文档。全部单元测试：`node --experimental-strip-types --test tests/*.test.ts`。

网页 v4：浅色清透水体材质，模式在指定时间内连续混合；粒子与流线提供独立密度、速度、亮度等控制，兼容人工调节与后端输入。

网页 v5：银白与冰蓝的清透水体、放缓的模式过渡、独立的稀疏星点背景；保留 40 秒演示、入睡事件和全部前景特效控制。
