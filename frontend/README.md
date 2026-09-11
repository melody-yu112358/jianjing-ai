# 渐静 · 双层光丝与决策回放

首页提供 60 秒路演案例：连续心率／呼吸曲线、预置个人参考范围、智能体短路径与调整记录，以及双层光丝主体和同步海浪／中文引导。

- 内层表达状态，外层仅在 10–20 秒按 4 秒吸气、6 秒呼气开合。
- 22 秒转为声音关注，38 秒减少口令，50 秒缩短安排，54–60 秒淡出。
- 案例由本地时间线驱动，不调用大模型；完成表示仪式结束，不表示检测到入睡。
- 原后端连接、人工控制和 `/lab` 水体页面保留；实时后端完整决策解释未接入。

本地使用 Node 22.13+、pnpm 11.19.0：`pnpm install --frozen-lockfile`，随后 `pnpm dev`。构建：`pnpm build`。测试：`node --experimental-strip-types --test tests/*.test.ts`。

构建后可用 `node scripts/export-inner-light.mjs /absolute/path/jianjing-demo.html` 导出单文件体验。海浪内嵌，中文人声仍依赖浏览器普通话音色。导出页面用于演示，不包含完整的 `/lab` 路由。

详见 [路演案例与验收](docs/ROADSHOW_DEMO.md)、[声音时间线](docs/AUDIO_DEMO.md)、[Agent 接口](docs/AGENT_INTERFACE.md)。

以下为早期版本记录，首页以以上说明为准。

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

## Phase 6

`/roadshow` 是独立决赛入口，首页已增加链接。可在播放前选择状态，一键启动固定模拟回放；已困路径30秒，其他路径60秒。暂停/重播/自动淡出、易读决策解释和技术展开均可用。原首页保留真实后端 Explainability 集成（上文“未接入”是早期记录）。

路演模式无后端请求或LLM调用；中文语音依赖浏览器，可关闭后配合主持人口播。部署前使用现有 `pnpm build`；素材建议与人工验收清单位于仓库 `docs/ROADSHOW_MATERIAL.md`。
