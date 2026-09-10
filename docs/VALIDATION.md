# Backend MVP 本地验证记录

## Phase 4B：手机PPG短测原型

基于最新main `a9407f6`，分支`feature/phone-ppg`。**物理手机未实测，Apple Watch未实接**。本次交付算法、独立采集页面和接入接口，不能将其描述为已经完成真实设备闭环验收。

- `python -m pytest -q`：**180 passed**，原146项测试文件未修改，新增34项；原两条第三方弃用提示保留。
- `node --test tools/ppg-demo/test_capture.cjs`：**6 passed**，模拟DOM/摄像头，不访问真实硬件。验证授权拒绝、torch不可用时释放摄像头、等待授权期间取消、751帧25秒采样/先关摄像头再提交、未前测时拒绝后测、空错误信息的可读提示。
- Python与Node合计**186项**通过。PPG已知45/60/72/90/120/150/180 BPM合成波形估计误差≤1.3 BPM；20/25/30fps、温和噪声和漂移通过；无覆盖、饱和、弱信号、随机噪声、断帧、频率改变和范围外主频被拒绝。这不是设备准确度指标。

`python scripts/test_ppg_ws.py`启动实际Uvicorn，按真实时间等待两个短测窗口，提交合成RGB均值，HTTP与双WebSocket联调退出码0：**56帧v1 + 56帧v2**，平均间隔**1.014秒**。90/72 BPM有效结果被引擎消费，field_sources=phone_ppg，Resp模拟，v2.data_source=mixed；无效波形不写入、TTL到期回退、summary保存前后值及reset清空均通过。

桌面内嵌浏览器实际加载了独立页面、读取summary，核对了未前测时的后测提示及布局；启动摄像头未获得可用采集流，没有生成物理PPG样本。由此发现浏览器可能返回空错误信息，已补充可读fallback，并通过Node回归。浏览器页面加载或模拟摄像头单测均不能替代手机后置镜头+闪光灯验收。

State Engine、Classification、Rule/LLM Controller、Visual Mapper、原模拟轨迹和三份消息/决策schema保持不变。没有新依赖、视频保存、HRV或真实呼吸。short-window BPM仅在原TTL内有效，期间模拟回退；混合baseline变化不可解释为疗效。

Apple Watch仅完成继承现有缓存接口的可选Adapter和官方原生bridge设计，没有原生App构建、HealthKit授权或设备连接。具体手机支持、误差、舒适度、可信HTTPS/WSS部署与实际设备链路仍待执行，见PHONE_PPG.md验收清单。

## Phase 4A：Sensor Adapter与混合信号

基于main `f6c8ae1`，分支`feature/sensor-adapters`。`python -m pytest -q`：**146 passed**，原104项文件未修改，新增42项；原有两条第三方弃用提示保留。无新增依赖，`pip check`和`git diff --check`通过。

三套默认模拟轨迹各181帧，与修改前main中Session产生的完整v1帧序列SHA256一致。新增验证涵盖部分/完整输入模型、字段来源汇总、mixed输入进入引擎、同秒不增加样本、TTL边界/回退/恢复、时钟回退、未来/旧/乱序/重复数据、reset隔离、无历史回填、结束后过期来源更新、REST状态以及v1/v2契约。NaN/Infinity请求返回422，修复初步实现中错误响应序列化导致500的问题。

`python scripts/test_sensor_ws.py --local`真实启动两个独立Uvicorn服务，以人工HTTP心率输入同时联调两套WebSocket，最终退出码0：

| 模式 | v1帧数 | v2帧数 | 平均间隔 | v2观察到的来源 |
|---|---:|---:|---:|---|
| simulated | 23 | 23 | 1.005秒 | simulated |
| mixed | 23 | 23 | 1.005秒 | simulated、mixed |

合计46帧v1 + 46帧v2。每帧按保存的既有schema校验。测试发送105、85、95的人工HR，验证实际输入更新、引擎last_consumed字段来源、停止发送后的2秒TTL回退、恢复、无效时间与非有限输入拒绝、reset改变session_id/seq归零并清空缓存。初次恢复用例只发送一次后等两帧，跨过测试TTL而失败；修正为恢复阶段持续发送后重跑通过，TTL规则未放宽。

State Engine、Classification、Rule/LLM Controller、Visual Mapper、Simulator场景逻辑和三份WebSocket/decision schema均未修改。v2仅更新已有data_source值；REST /health及/api/demo的既有来源字段也按有效输入更新，默认响应仍simulated。

Adapter接口使用同步非阻塞缓冲读取，HTTP生产者与1Hz采样解耦；POST或同秒读取不会额外推进State Engine。来源变化不重建baseline；历史窗口可能包含混合来源，不能将变化作为疗效证据。该验证未使用任何真实设备，不包含认证、校准、真实呼吸、HRV、数据库或多用户。

## Phase 3.5：Frontend Control Protocol v2

基于已合并Phase 3的main（185c69c），分支`feature/frontend-control-v2`。依据用户提供的`AGENT_INTERFACE.md` v2.0；文件SHA256为`AED2F603C9ABEDD1C392061AFE291191270B98C730DCDB9D20E9C758CA6C10C3`。未收到前端独立JSON Schema、Zod实现或mock脚本，因此验证的是文档约束及据此生成的后端schema，未声称完成前端代码级或浏览器验收。

`python -m pytest -q`：**104 passed**，原71项测试文件未修改，新增33项。覆盖v2持续消息、序列/重置/重连、多客户端与v1共存、可选仪表、三轨迹、参数边界、五模式选择路径、渐退连续、停止归零、跨字段schema、mock_llm与未配置LLM回退。`python -m pip check`、`git diff --check`通过；原有两条第三方弃用提示仍存在。

`python scripts/test_control_ws.py --local --quiet`：实际Uvicorn/TCP/WebSocket联调退出码0；三个独立会话并行，总计**190帧v2 + 190帧v1**，另验证各会话的reset、discomfort及debug=false：

| 场景 | 每种协议帧数 | v2平均间隔 | v2强度首尾 | 已验证阶段 |
|---|---:|---:|---|---|
| calming | 90 | 1.006秒 | 0.659 → 0 | assess → guided_breathing → settling → fade_out → end |
| not_responding | 45 | 1.006秒 | 0.634 → 0.365 | assess → guided_breathing → switch_method |
| already_sleepy | 55 | 1.006秒 | 0.403 → 0 | assess → settling → fade_out → end，无强制呼吸训练 |

每帧v2通过JSON Schema与Pydantic双校验、64KiB大小、UTC新鲜度、递增seq/timestamp检查。calming和already_sleepy实测完整淡出，not_responding到180秒的超时退出通过单元测试。三场景使用各自预设self_report，数值不代表人的疗效比较。

初次联调脚本未持续读取并行v1连接，导致接收端背压及重置前旧帧积压，测试失败；已修正为两协议逐帧读取，并重跑上表完整联调通过。服务端v1端点未作修改。

State Engine、Classification、Rule/LLM决策逻辑、旧Frame及两个v1/decision schema均无差异。新增jsonschema仅为开发测试依赖。实际前端schema可通过脚本`--frontend-schema`补充双契约验证；目标设备视觉舒适度、浏览器帧率、WSS代理和真实硬件均不在本次验证范围内。

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

## Phase 4C verification

- 180 Python tests passed; 13 Node capture/tool tests passed (193 total, all previous 186 retained).
- Actual Uvicorn + HTTP + three /ws/control snapshots passed using check_device_acceptance.py; source simulated without external input.
- Unreachable server check returned exit code 1 with an explicit connection error.
- Desktop browser opened diagnostic page and displayed live session/source/TTL and untested camera capabilities correctly.
- No physical smartphone or Apple Watch was tested. Synthetic / mocked camera tests are not physiological validation.

## PPG calibration diagnostics verification

185 Python + 15 Node tests passed (200 total); all prior 193 cases retained. Added tests for step rejection classification, curved exposure rejection, segment disagreement diagnostics, offline replay, HTTP rejection without ingestion, failed-record retention and warmup duration. No physical retest of this change. User reports OnePlus Ace2 Pro PJA110 / browser 40.10.21.1_66b0631_260821 camera and torch flow works but accepted BPM remains unstable.
