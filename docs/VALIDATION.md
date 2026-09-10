# Backend MVP 本地验证记录

## 第三阶段验证

分支：`feature/llm-controller`，基于Phase 2。`python -m pytest -q`：**71 passed**，包含原24项及47项新增用例。原24项中仅将“LLM占位必须抛NotImplementedError”的过期断言更新为“未配置模型回退规则”；原9项测试、State Engine、分级、三套场景与两个JSON Schema均未修改。第三方原有两条弃用提示仍存在。`python -m pip check`通过。

新增覆盖：三场景rule完整轨迹一致；三模式与环境配置；严格JSON、动作白名单、缺失/额外字段、范围/类型、内容限制；超时和HTTP错误回退；不适取消请求；异步结果按当前状态重新校验；最多3项记忆与会话重置；已困倦完整短路径；Provider请求契约与日志不泄露响应。

`python scripts/test_phase3_live.py`实际启动Uvicorn并经TCP/WebSocket测试，退出码0。每用例接收45帧，共225帧，另验证不适REST即时响应与下一帧停止：

| 用例 | 平均推送间隔 | 模型路径结果 | 不适停止 |
|---|---:|---|---|
| rule | 1.008秒 | 0次调用 | 通过 |
| mock_llm | 1.016秒 | 2次本地Provider成功 | 通过 |
| llm / 本地HTTP协议服务 | 1.016秒 | 2次HTTP请求及校验成功 | 通过 |
| llm / HTTP超时 | 1.010秒 | 2次超时，回退规则 | 通过 |
| llm / 未配置模型 | 1.016秒 | 2次配置缺失，回退规则 | 通过 |

各用例均在not_responding场景进入switch_method；每帧通过现有Frame校验，timestamp递增。超时用例确认服务收到请求后延迟2秒，控制器在1秒期限后回退。初次测试使用0.05秒期限，可能在请求到达前超时，因此修正测试时限后重跑以上完整用例。

**未配置真实供应商Key，也未调用外部大模型。** 实际HTTP验证使用本地协议Stub及合成测试凭据，证明请求、解析、调度与回退链路；不代表已验证具体模型的兼容性、输出质量或疗效。部署者需按README配置供应商后查看`/api/controller`确认成功调用。

本阶段WebSocket契约仍为1.1，RitualDecision结构不变；没有硬件、HRV、数据库或前端改动。HTTPX从已有开发依赖移至运行依赖，未增加新的依赖包。

## 第二阶段验证

分支：`feature/state-classification-controller`。Python 3.12.4，原项目虚拟环境，无新增依赖。

`python -m pytest -q`：**24 passed**，原 `tests/test_backend.py` 未修改，原有9项全部通过；另有15项第二阶段用例。第三方库原有两条弃用提示仍存在。

新增覆盖：连续稳定计数与中断重置、无干预时不判为未响应、三种场景、低唤醒起点、discomfort在baseline前/引导中/淡出中/结束后即时锁存、反馈REST及WebSocket同步、同输入控制器可复现、动作白名单、统一决策schema、原有字段路径保留。

`python scripts/test_phase2_ws.py --base-url http://127.0.0.1:8001`：真实Uvicorn网络测试通过，退出码0。合计三场景220帧，另外验证不适REST即时响应和活动连接下一帧停止。

| 场景 | 实际网络帧数 | arousal首尾 | 关键流程 |
|---|---:|---|---|
| calming | 120 | 0.780 → 0.076 | t=62 stable；t=72 ready_to_disengage / fade_out；t=82 end |
| not_responding | 45 | 0.740 → 0.787 | t=39 not_responding / switch_method |
| already_sleepy | 55 | 0.380 → 0.355 | 无guided_breathing；t=28 stable；t=38 ready_to_disengage / fade_out；t=48 end |

使用每个场景的默认self_report，因此两场景先验并不相同。本轮验证的是行为分支，不用首尾数值比较人的睡眠效果。每条消息均验证契约、递增timestamp及平均1Hz间隔。完整180秒未响应后的超时结束在单元测试中直接推进验证。

完整网络测试之后，补充了已困倦且低唤醒时的settling候选分级（避免等待稳定时长期间仍显示activated），以及slow_down动作的具体reason。全部24项再次通过；最终已困倦分级和结束路径又通过55帧实际网络复核。baseline未满前仍为confidence=0的activated占位，不表示判断为高唤醒。

接口契约为1.1，原顶层字段未改变。旧的严格1.0 JSON Schema需更新以接受新增子字段。当前未调用外部LLM，也未接入真实硬件。

## 第一阶段历史记录

日期：2026-09-10。环境：Windows、Python 3.12.4、项目独立虚拟环境。

## 自动化逻辑与接口测试

`python -m pytest -q`：**9 passed**。第三方Starlette/AnyIO显示两条弃用提示，无测试失败。

`python -m pip check`：**No broken requirements found**。

完整calming轨迹（mind_racing）：assess t=0 → guided_breathing t=9 → settling t=39 → fade_out t=69 → end t=79。未响应轨迹t=39切换方式，t=170开始按时结束，t=180进入end。所有阈值用于交互演示，不表示医学结论。

## 实际 Uvicorn 和 WebSocket 验证

启动：`python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`

运行：`python scripts/test_ws.py --verify --samples 45`，退出码0。

| 场景 | 连续帧数 | 初始arousal | 第45帧arousal | 变化 | 已观察阶段 |
|---|---:|---:|---:|---:|---|
| calming | 45 | 0.780 | 0.470 | -0.310 | assess → guided_breathing → settling |
| not_responding | 45 | 0.780 | 0.827 | +0.047 | assess → guided_breathing → switch_method |

两场景均使用mind_racing以保持主观先验相同。每帧通过Pydantic契约检查；时间戳递增，平均接收间隔通过0.8–1.3秒校验。两个场景串行测试约88秒。

180秒完整路径通过直接推进模拟时钟验证；实际网络测试覆盖每个场景前45帧，未声称完成两次180秒网络测试。以上是合成输入的工程验证，不是人体试验、入睡判断或疗效证据。
