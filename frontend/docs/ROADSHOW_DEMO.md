# 60 秒路演案例与 Explainability v1

## 完整流程

1. 选择「脑子停不下来 / 身体紧绷 / 很累但还清醒 / 已经比较困」，默认 mind_racing。
2. 点「查看今晚总览」：展示最近7次**模拟历史**（arousal 46%、stability 67%）与今晚案例、简短路径，再启用播放。
3. 播放原有60秒故事；曲线、双层光丝、海浪、中文引导和解释窗口同步；可暂停、恢复、重置和重播。
4. 结束为主动结束仪式，不表示检测到入睡或保证改善。

主流程不要求摄像头、PPG或Apple Watch。保留原有人工探索、后端连接与lab。

## 默认 mind_racing 黄金时间线

| 秒 | 体验 / 解释 |
|---|---|
| 开始前 | 近期模拟参考 → 今晚选择 → 总览 → 今晚短路径 |
| 0–8 | 「不用急着睡着。先让呼吸自然来去。」观察连续变化，展示参考带 |
| 8 | 预设计划说明展开；先一轮慢呼气，再观察并调整 |
| 10–14 | 轻轻吸气，外层舒展，continue_breathing |
| 14–20 | 缓缓呼气，外层回收；读数短暂下降后反弹 |
| 20–22 | 退出固定节拍，重新观察；尚未证明稳定 |
| 22 | switch_to_grounding：取消下一轮，改为海浪声音关注；明确不必追赶节拍 |
| 38 | 后续趋稳，reduce_stimulation：保持声音关注，减少口令，不增加练习 |
| 50 | reduce_stimulation：跳过额外练习，缩短后续安排；「已经够了。接下来不用再看我。」 |
| 54–60 | fade_out → end，音画淡出，保留曲线与决策历史 |

`body_tense` 降低初始 arousal、使用4/5秒吸呼及19秒退出节拍，22秒动作为 switch_to_natural_breathing。`tired_but_awake` 使用更低初始 arousal。`already_sleepy` 使用低唤醒、较稳定轨迹和自然呼吸，省去固定节拍与22秒换方法，不朗读吸呼口令。60秒黄金故事特指默认 mind_racing，其他自述不硬套“干预失败”的叙述。

## 三层来源

- `lib/roadshow-demo.ts`：原有确定性轨迹、控制消息、阶段与语音节点，支持自述变体。
- `lib/roadshow-explainability.ts`：把预设案例适配为 `ExplainabilitySnapshot`，不用于判断 live sensor；分类与理由仍为 authored fixture，confidence 不计算。
- `components/roadshow-insights.tsx`：只展示 Snapshot 与传入的曲线，不自己产生AI判断；backend与demo复用。

个人 HR 72–80、respiration 12–16 参考带保留，仅 demo 显示。7次睡前状态历史同样是模拟值，固定 `baseline_source=simulated_demo_history`；不是真实用户数据库。DEMO `decision_source=null` 并明确标记「模拟案例 · 决策回放」。

真实后端说明见 [Explainability Contract](../../docs/EXPLAINABILITY_INTERFACE.md)。真实 backend mode：`/ws/control` 驱动视觉，`/api/explainability` 提供State Engine与实际Controller解释。缺失或不匹配时显示暂无。v1仍兼容视觉，但完整解释配对要求v2 session_id。

连接区可只观察现有后端会话，也可用所选状态新建共享后端会话。后者通过现有 `POST /api/demo` 提交 self_report，already_sleepy 配对应已有场景，其他选择使用 calming 场景。后端既有判断窗口默认30秒、最长180秒，**不伪装成60秒回放**。

## 视觉与声音

保留内层状态光丝与外层呼吸包络、独立几何、柔光和自然流动。更换自述后会重建音频/朗读实例，避免重播“已经较困”仍残留上一个案例的吸呼口令。声音仍为 demo 使用；真实 backend 暂不自动朗读或接管海浪。固定节拍不是测得的实际吸呼相位。

原参考：parthsali/Breathing-App 的内外双层计时思路。本轮未复制源码，未更换既有视觉实现。

## 自动命令

后端根目录：`python -m pytest -q`。

frontend目录：

```bash
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
pnpm build
```

Node 22.13+、pnpm 11.19.0，沿用锁文件。云端使用既有 Sites 安装与build脚本；修复 `sites-env.sh / install-pnpm.sh / build-verified.sh` 的Git执行权限，避免全新clone后Permission denied。

新增测试包括所有状态选择对应数据、baseline/计划、六项State字段、Decision Trace节点、22秒换方法、50秒减少刺激、54–60退出、60秒完整回放、暂停/恢复/重播、来源与会话边界、真实Python输出的跨端校验，以及复用React组件的实际渲染。

## 尚未验证的浏览器/路演工作

本次云端预览服务不可用，未完成真实浏览器E2E，不把服务器渲染或虚拟时间测试冒称浏览器验收。合并前请在Edge/Chrome实测：四种自述、总览/播放按钮、12秒暂停恢复、22秒后无吸呼口令、38/50秒减提示、54–60秒音画退出、重播切换较困案例、静音、中文音色、小屏幕与投屏排版。

线上联调需验证WSS/HTTPS、实际origin的CORS配置、断线/跨会话reset、真实provider授权与网络。确认采用外部LLM成功后才讲“实时模型”；fallback必须讲规则执行。PPG、Apple Watch和真实历史数据库留作后续。
