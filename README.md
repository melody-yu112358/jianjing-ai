# 渐静 jianjing-ai

医疗健康黑客松 **backend MVP**：模拟身体信号 → State Engine → 规则状态机 → WebSocket → 前端可消费的实时 JSON。

Python 3.11+ / FastAPI。默认使用rule控制器和合成信号。Phase 4A新增可插拔Sensor Adapter，支持通过HTTP接收外部心率并与模拟呼吸混合；未接真实设备、HRV、数据库或登录，不包含正式前端。命令行接收器用于联调。

Phase 4B新增独立手机PPG短测工具、服务端BPM估算和前后测记录。**算法/接口已实现，物理手机尚未验收**；Apple Watch仅提供桥接Adapter和设计文档。

**`arousal` 和 `stability` 是用于交互控制的 prototype state index，不是医学诊断指标，也不能判定真实脑区活动、入睡或疗效。** 模拟轨迹按时间预设，不是控制器真实改变了身体；本版验证接口与决策分支。

## 架构与职责

Phase 3.5 新增独立 `/ws/control` v2.0，旧 `/ws/state` v1.1 保留。State Engine、分级及两种 Controller 决策逻辑不变。v2 接入说明见本文末尾。

```text
Sensor / Simulator
       ↓
State Engine
       ↓
State Classification
       ↓
Hard Safety Rules
       ↓
RuleBasedController / LLMController
       ↓
Validated RitualDecision
       ↓
WebSocket
       ↓
Frontend Visualization
```

State Engine计算相对baseline的信号与窗口趋势；State Classification累计稳定时长，给出state_class和reason_codes；Controller从有限动作中选择流程，Session保存其上下文。前端只消费JSON，不需要知道控制器类型。

当前State Engine和分级均是实时交互控制prototype，**不用于判断真实睡眠阶段、精神疾病或具体脑区状态**。state_class=stable也不表示已睡着。

## 目录

```text
jianjing-ai/
├── backend/
│   ├── main.py                # FastAPI入口、REST、CORS
│   ├── models.py              # 唯一消息模型与输入枚举
│   ├── config.py              # 阈值、窗口、分级优先级及控制时长
│   ├── session.py             # 共享会话、重置、时间推进
│   ├── sensors/simulator.py   # 合成轨迹插值
│   ├── state/arousal.py       # baseline与rolling window
│   ├── state/classification.py # 持续稳定与可解释状态分级
│   ├── ritual/controller.py   # 统一接口、规则实现、会话上下文
│   ├── llm/                   # Provider、Prompt、校验与异步LLM控制器
│   └── api/websocket.py       # /ws/state
├── data/
│   ├── demo_calming.json
│   ├── demo_not_responding.json
│   └── demo_already_sleepy.json
├── docs/state.schema.json     # 可交给前端的JSON Schema
├── docs/ritual-decision.schema.json # 所有controller共用的输出模型
├── scripts/test_ws.py         # 实际网络接收与双场景验证
├── scripts/test_phase2_ws.py   # 三场景与不适停止的实际网络验证
├── tests/test_backend.py      # 完整轨迹及接口回归测试
├── tests/test_phase2.py        # 第二阶段规则及兼容性测试
├── requirements.txt
└── requirements-dev.txt
```

## 安装和启动

从仓库根目录执行。下面的命令使用项目虚拟环境，避免改变系统依赖。

Windows PowerShell：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

macOS / Linux：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

只启动服务可安装 `requirements.txt`；CLI及测试需 `requirements-dev.txt`。以下命令中的 `python` 指项目虚拟环境的 Python，可激活虚拟环境或替换成上面的完整路径。

- 健康检查：`GET http://127.0.0.1:8000/health`
- REST交互文档：[Swagger UI](http://127.0.0.1:8000/docs)
- WebSocket：`ws://127.0.0.1:8000/ws/state`
- 机器可读消息契约：`GET /api/schema/state`

默认是 `calming / mind_racing`。这是**单进程、一个共享演示会话**，必须使用一个 worker。所有连接看到同一轨迹，各自约每秒接收一次；连接数量不会加速模拟器。重启服务丢弃内存状态。

## 场景切换及 self_report

`POST /api/demo` 重启整个共享会话，清空 baseline、滑动窗口及控制器。已连接客户端在下一次推送收到新会话状态，无需重连；同场景重复POST也会重启。新会话从首次WebSocket取帧开始计时，没人连接时不提前消耗演示。已经开始的会话即使暂时无人连接也按经过时间推进，重连不自动重置。

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/demo -ContentType 'application/json' -Body '{"scenario":"calming","self_report":"mind_racing"}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/demo -ContentType 'application/json' -Body '{"scenario":"not_responding","self_report":"body_tense"}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/demo -ContentType 'application/json' -Body '{"scenario":"already_sleepy"}'
```

跨平台 curl：

```bash
curl -X POST http://127.0.0.1:8000/api/demo -H 'Content-Type: application/json' -d '{"scenario":"calming","self_report":"mind_racing"}'
```

请求：`scenario` 必填，可为 `calming`、`not_responding` 或 `already_sleepy`。`self_report` 可省略或为null，使用场景预设；提供时只能是：

| self_report | 交互含义 | 初始arousal |
|---|---|---|
| mind_racing | 思绪停不下来 | 0.78 |
| body_tense | 身体紧绷 | 0.74 |
| tired_but_awake | 疲惫但仍清醒 | 0.62 |
| already_sleepy | 已有困意 | 0.38 |

未知场景、未知报告或多余字段返回HTTP 422，不重置已有会话。修改self_report也需调用同一POST并重新建立baseline，不支持中途隐式改变参考。

POST返回与 `GET /api/demo` 相同：

```json
{"scenario":"calming","self_report":"mind_racing","generation":2,"data_source":"simulated","schema_version":"1.1","scope":"shared_process"}
```

`generation` 每次重置加1。为保持指定的WebSocket字段不变，模式、版本和generation放在REST状态中。默认前端显示“模拟数据”；Phase 4A的mixed模式按data_source显示混合来源，不能标为全真实传感器。如允许其他操作者切换，可轮询GET检测generation变化。该MVP没有鉴权，应仅用于本地或可信演示网络，不能作为公开多用户服务部署。

## Simulator

JSON文件提供时间关键点，逐秒线性插值，加确定性的正弦微扰；同一场景与时刻输出可复现，无随机种子依赖。

- `calming`：前10秒约86次/分心率、16次/分呼吸；之后逐步降至约70与10，微扰逐渐减小。
- `not_responding`：从相同身体信号开始，随后略升至约90与17.5，微扰不减小。
- `already_sleepy`：起始约70次/分心率与11次/分呼吸，波动很小，默认self_report=already_sleepy；直接进入自然呼吸与减少刺激，持续稳定后提前结束。若覆盖self_report，控制器按新报告决定，不通过场景名强制走短路径。
- `self_report`改变状态先验和控制偏好，不修改合成身体信号。
- 场景文件是**合成演示参数**，不是临床参考范围或真实疗效数据。

## State Engine 的可解释规则

所有时间均为模拟会话经过秒数，正常速度为1倍。

1. 初始10个样本（t=0…9秒）的均值形成固定baseline；后续不会漂移。它只是演示参考，非标准生理基线。
2. 最近10个样本构成rolling window。baseline尚未完成时，arousal等于主观先验、stability=0、trend=flat；此时stage=assess。0代表尚未建立稳定度，不是身体极不稳定。
3. `clamp(x)`限制在0…1并保留三位小数：

```text
arousal = clamp(prior
                + 0.35 * (window_mean_hr - baseline_hr) / 15
                + 0.35 * (window_mean_resp - baseline_resp) / 6)
stability = clamp(1 - 0.5 * std_hr / 2 - 0.5 * std_resp / 0.8)
```

标准差为总体标准差。波动小不等于低唤醒，所以两指标独立输出。`trend`比较当前arousal与10秒前arousal：差值 < -0.015 为down，> 0.015 为up，否则flat；不足11个有效状态时为flat。所有权重、尺度及阈值均为演示交互参数。

## State Classification

参数位于 `backend/config.py` 的 `StateConfig`，判断实现独立于控制器，位于 `backend/state/classification.py`。可通过 `StateEngine(report, StateConfig(...))` 在测试中注入配置；服务采用默认配置，调整默认值后重启。分级优先级也在配置中。

| state_class | 默认判定 | 交互含义 |
|---|---|---|
| discomfort | 用户明确报告不适；优先级最高，不需传感数据 | 立即停止 |
| activated | baseline尚未完成，或以下条件均不满足 | 暂不足以切入稳定流程，不等于测得焦虑 |
| settling | trend=down、stability≥0.5，且心率下降≥1或呼吸下降≥0.5；或本人报告已困倦且低唤醒、呼吸稳定 | 可减少引导强度 |
| stable | 连续10个1Hz样本都满足稳定条件 | 已保持一段时间稳定 |
| not_responding | 干预开始≥30秒，arousal相对初始先验下降<0.05，且未进入stable/ready | 调整方式，不强迫加深呼吸 |
| ready_to_disengage | 连续20个样本稳定，且arousal≤0.35；already_sleepy报告可使用稳定条件的≤0.4 | 减少交互并淡出 |

**稳定条件**：趋势窗口已完整、呼吸总体标准差≤0.35、stability≥0.65、arousal≤0.4、trend非up。任何一秒不满足，连续计数归零。10/20秒分别由rolling_samples×stable_windows/ready_windows配置；“两窗口”表示两个窗口长度的连续时长，绝不是两次相邻且高度重叠的窗口查询。每个会话秒只计一次，多客户端读帧不增加时长。

除不适和baseline等待外，按 `ready_to_disengage → stable → not_responding → settling → activated` 首个命中规则输出。持续计数和干预经过时间随场景重置清零。控制器在退出assess后开始计干预时间，不把等待baseline算作干预无效。

`confidence`是证据完整度与一致性的启发式分值，非统计概率或临床置信度：baseline待建立时0；趋势未满时coverage=0.5，已满时coverage=1；`min(0.95, coverage × (0.5 + 0.5 × stability))`。用户明确报告不适时为1，表示收到明确指令，绝非对病情的判断。

主要reason_codes：

| reason_code | 触发依据 |
|---|---|
| self_report_* | 本次开始时的主观报告 |
| baseline_pending / baseline_ready | 参考数据是否建立 |
| heart_rate_decreasing / resp_rate_decreasing | 当前窗口均值相对baseline下降达到对应阈值 |
| rolling_trend_down / flat / up | arousal最近10秒变化；实际代码带rolling_trend_前缀 |
| trend_window_pending | 有效趋势样本不足 |
| respiration_stable | 当前呼吸标准差达标 |
| low_arousal_sleepy_start | 已困倦报告、arousal≤0.4、stability≥0.65、呼吸标准差≤0.35且trend非up；仍需累计时长才能成为stable/ready |
| stable_duration_met | 已满足配置的stable持续时长 |
| stable_for_two_windows | 已连续满足稳定条件至少两个rolling window长度 |
| no_improvement_after_intervention | 干预满30秒但下降不足 |
| disengagement_criteria_met | 已满足持续稳定与退出条件 |
| settling_criteria_not_met | 当前未满足其他分级规则 |
| user_reported_discomfort | 用户主动报告不适 |

reason_codes为可扩展字符串列表；前端对未知代码保留原值，不应报错。数值下降原因和rolling trend含义不同：前者相对baseline，后者相对10秒前。

## Rule-based Ritual Controller

`RitualController.decide(state, context) -> RitualDecision`是统一抽象接口。当前 `RuleBasedController` 是纯函数式实现，相同state和不可变ControllerContext产生相同输出，不把状态保存在controller内部。Session负责保存当前stage、进入时间、最近决策时间及淡出起始强度。

Phase 3的`LLMController`实现相同接口，后台调用可替换Provider；输出先校验，再映射为同一RitualDecision，错误自动回退RuleBasedController。决策schema见[ritual-decision.schema.json](docs/ritual-decision.schema.json)，与Phase 2完全相同。具体运行模式见下节。

控制器只看self_report、状态及经过时间，**不读scenario名称**。初次baseline就绪时退出assess，常规阶段每30秒决策；ready_to_disengage可提前触发淡出，不适立即停止，淡出计时每秒更新。阶段如下：

| 阶段 | 进入或离开条件 | 呼吸秒数 |
|---|---|---|
| assess | 等待10个baseline样本；already_sleepy随后直接settling，其他进入guided_breathing | 0 / 0 |
| guided_breathing | 下一决策点：分类为settling/stable则进入settling；not_responding或反应不明确则switch_method | 4 / 6；body_tense为4 / 5 |
| settling | ready_to_disengage立即进入fade_out；常规决策点未响应或变差则switch_method | 0 / 0 |
| switch_method | 使用自然呼吸或声音关注；后续分类为settling/stable才进入settling | 0 / 0 |
| fade_out | 从进入时强度线性渐弱10秒，随后end；任何未结束会话最迟170秒进入淡出 | 0 / 0 |
| end | 终态，无需达到平静目标；不会自动重启 | 0 / 0 |

有限动作只有：`continue_breathing`、`slow_down`、`reduce_stimulation`、`switch_to_natural_breathing`、`switch_to_grounding`、`fade_out`、`end`。其中slow_down用于guided_breathing中trend=down且arousal<0.6时降低视听运动强度，吸呼时长保持不变。body_tense在切换时采用自然呼吸，其余采用声音关注。message来自预设文案，reason是本次控制依据，state.reason_codes是观察依据，两者分别保留。

每个RitualDecision含stage、action、inhale_sec、exhale_sec、visual_intensity、audio_intensity、message、reason。序列化时将visual_intensity映射到原有visual.intensity，将message映射到原顶层message，其余落入ritual，避免重复字段。

### 用户不适立即停止

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/feedback -ContentType 'application/json' -Body '{"event":"discomfort"}'
```

REST立即返回完整Frame：state_class=discomfort、stage/action=end、吸呼秒数和所有视听强度为0。已连接WebSocket下一次推送（约1秒内，不计网络延迟）同步停止状态；不等待30秒决策，也不先淡出。不适标记锁存至POST /api/demo重置，普通后续读数不能重新启用训练。尚无baseline、淡出中、已经end时同样接受不适；重复上报不新增传感样本。前端点击不适按钮应立即停止本地动画/声音，再处理服务端响应。

0 / 0 表示“无需定时吸呼”，不是屏息；前端不能用它计算除法或呼吸频率。消息避免宣称已入睡。默认模拟模式180秒后保持最终signals/state，继续每秒推送end帧与新的timestamp，visual全0，直到断开或POST重启。Phase 4A的mixed模式在180秒后也冻结state，但继续刷新有效signals和来源，避免过期外部值伪装为实时心率；这些更新不重新启动引导。

## WebSocket 消息契约 v1.1

连接后立即推送一帧，以后约每秒一帧UTF-8 JSON文本。不需要发送订阅消息；当前通道只提供服务端推送，命令通过REST。实际网络调度可有轻微偏差，不保证硬实时。慢客户端可能跳过中间样本，但状态引擎按经过秒数补算，单会话最多181个样本。

```json
{
  "timestamp": 1789000000.123,
  "signals": {"heart_rate": 86, "resp_rate": 15},
  "state": {
    "arousal": 0.72, "stability": 0.41, "trend": "down",
    "state_class": "activated", "confidence": 0.705,
    "reason_codes": ["baseline_ready", "rolling_trend_down", "settling_criteria_not_met"]
  },
  "ritual": {
    "stage": "guided_breathing", "inhale_sec": 4, "exhale_sec": 6,
    "action": "continue_breathing", "audio_intensity": 0.70, "reason": "hold_current_stage"
  },
  "visual": {"intensity": 0.70, "noise": 0.62, "speed": 0.68},
  "message": "先不用努力睡着，只把呼气稍微拉长一点。"
}
```

以上为字段示例，非特定时刻计算结果。所有字段必填且不为null，不增加顶层字段。

相对1.0，原有字段路径、类型及六个stage保留，只新增state中的state_class/confidence/reason_codes，以及ritual中的action/audio_intensity/reason。直接读取旧字段的前端可继续使用；若前端使用1.0的strict schema（additionalProperties=false），需要更新schema才能接受新增字段，不能声称对严格校验器零改动兼容。schema_version在GET /api/demo中变为1.1。

| 字段 | 类型与单位 | 解释 |
|---|---|---|
| timestamp | number，Unix UTC秒 | 推送时刻；JS使用`new Date(timestamp * 1000)`；非相对时间 |
| signals.heart_rate | number，次/分，>0 | 当前合成心率 |
| signals.resp_rate | number，次/分，>0 | 当前合成呼吸频率，不是引导目标 |
| state.arousal | number，[0,1] | 原型唤醒指数 |
| state.stability | number，[0,1] | 原型窗口稳定度 |
| state.trend | down / flat / up | 唤醒指数相对10秒前趋势 |
| state.state_class | 六类交互状态枚举 | 观察分级，区别于ritual.stage |
| state.confidence | number，[0,1] | 证据完整性与一致性，不是医学概率 |
| state.reason_codes | string[] | 可解释触发条件 |
| ritual.stage | 六阶段枚举 | 当前控制阶段 |
| ritual.inhale_sec / exhale_sec | number，秒，≥0 | 提示节奏；0代表自然呼吸 |
| ritual.action | 七类有限动作枚举 | 执行意图 |
| ritual.audio_intensity | number，[0,1] | 归一化声音强度；前端负责实际播放映射 |
| ritual.reason | string | 控制决策依据 |
| visual.intensity / noise / speed | number，[0,1] | 无量纲动画参数，不是脑活动或物理速度 |
| message | string | 当前中文提示 |

规则模式常规强度为`(0.2 + 0.65 * arousal)`，settling/switch_method或slow_down动作乘0.65；fade_out使用进入前一帧的强度渐退。`noise=(1-stability)*intensity`，`speed=(0.2+0.8*arousal)*intensity`，全部clamp。规则模式audio_intensity与视觉强度相同；LLM可分别选择两项强度，end均为0。前端可平滑插值，但不可把视觉变平静宣称为实测疗效。

正式JSON Schema在[docs/state.schema.json](docs/state.schema.json)，与 `Frame` 模型自动比对。WebSocket不会自动出现在OpenAPI中，因此额外提供schema端点。保持v1字段稳定；未来破坏性改动应提供新的版本契约。

## 前端如何接入

下面仅是给队友的接口片段，本仓库不实现页面：

```javascript
await fetch('http://127.0.0.1:8000/api/demo', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({scenario: 'calming', self_report: 'mind_racing'})
});
const socket = new WebSocket('ws://127.0.0.1:8000/ws/state');
socket.onmessage = ({data}) => {
  const frame = JSON.parse(data);
  // 用visual更新动画，用ritual更新阶段；message用于显示。
  // inhale_sec === 0时停止节拍提示；end时隐藏引导，保持自然呼吸。
  console.log(frame);
};
socket.onclose = () => console.log('连接已断开，可显示重连按钮');
// 离开体验时：socket.close();
```

默认REST允许 `http://localhost:5173` 与 `http://127.0.0.1:5173`。其他来源通过环境变量 `CORS_ORIGINS`设置逗号分隔列表。CORS是REST浏览器策略，不是WebSocket鉴权。两人跨电脑联调时，在可信局域网使用`--host 0.0.0.0`，前端地址换成后端电脑IP；HTTPS页面应通过支持WebSocket的HTTPS代理使用wss。

## 实际运行测试

启动服务后在另一个终端运行：

```bash
python scripts/test_ws.py --scenario calming --samples 120
python scripts/test_ws.py --scenario not_responding --self-report body_tense --samples 60
python scripts/test_ws.py --verify --samples 45
python scripts/test_ws.py --scenario already_sleepy --samples 55
python scripts/test_phase2_ws.py
python -m pytest -q
```

CLI每次会先POST重置共享会话，避免跟其他演示同时运行。`--verify`串行采集两场景各45帧（约88秒），校验每帧schema、递增时间戳、平均1秒推送，以及calming的arousal下降超过0.2并进入settling、not_responding进入switch_method。成功返回退出码0，失败返回非0。

`test_phase2_ws.py`约需3分40秒：依次采集calming 120帧、not_responding 45帧、already_sleepy 55帧，再验证不适REST响应和活动WebSocket停止状态。三个场景串行运行，避免重置互相干扰。

单元测试无需等待180秒，直接推进完整轨迹，覆盖四种self_report、baseline固定、滑动窗口、不同阶段、渐退和结束、重复读帧、长时间无人连接、输入校验、schema一致性、断开重连、活动连接场景重置和CORS。网络CLI补充真实Uvicorn和TCP/WebSocket验证。

本次实测结果见[本地验证记录](docs/VALIDATION.md)。

## 开发约束

只修改本后端，前端由队友独立实现。真实设备和医疗验证需另行设计，不能直接把当前演示规则或LLM文案当成医疗判断。

## Phase 3 控制器模式

```text
Simulator → State Engine → State Classification
                                     ↓
                              Hard Safety Rules
                                     ↓
                     RuleBasedController / LLMController
                                     ↓
                          Validated RitualDecision
                                     ↓
                          WebSocket → Frontend
```

`CONTROLLER_MODE`只支持`rule / mock_llm / llm`，默认`rule`；配置在启动时读取，改变后重启。Session重置会清空请求缓存与最近决策，取消未完成请求。

| 模式 | 行为 | 外部请求 |
|---|---|---|
| rule | Phase 2规则路径，原始三场景行为保持 | 无 |
| mock_llm | 确定性的本地Provider，走与真实模型相同的Prompt输入结构、校验和结果应用路径；它本身不是模型 | 无 |
| llm | 请求配置的模型服务；缺少配置或请求/校验失败时自动回退规则 | 已配置时每阶段至多一次 |

Windows PowerShell例子：

```powershell
$env:CONTROLLER_MODE = 'mock_llm'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

真实Provider配置：

```powershell
$env:CONTROLLER_MODE = 'llm'
$env:LLM_BASE_URL = 'https://your-provider.example/v1'
$env:LLM_MODEL = 'your-model-name'
$env:LLM_API_KEY = Read-Host '模型 API Key' -MaskInput
$env:LLM_TIMEOUT_SEC = '3'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

macOS/Linux可用`export CONTROLLER_MODE=mock_llm`设置模式；其他变量同名。`.env.example`只提供空模板，**不会自动读取.env文件**，需要将配置导入进程环境。真实Key不要写入源码、README、测试或提交；`.env`及`.env.*`默认被忽略，仅`.env.example`例外。

Provider是chat-completions协议适配器：请求`LLM_BASE_URL + /chat/completions`，使用Bearer Key、配置的model、system/user messages及`response_format.type=json_schema`。供应商必须支持此协议与严格结构化输出；不支持时返回错误并回退，不静默改用无约束文本。没有固定模型或固定供应商地址。非此协议的服务通过实现`LLMProvider.generate_decision(payload)`并注入LLMController替换；无需改State Engine或前端。外部地址要求HTTPS，本地测试允许loopback HTTP，不自动跟随重定向。

### 输入与短期记忆

模型只接收State模型中的加工指标及枚举上下文，不接收signals、逐秒流、原始音频、硬件信息或个人身份信息。示例：

```json
{
  "self_report": "mind_racing",
  "state_class": "not_responding",
  "arousal": 0.71,
  "stability": 0.42,
  "trend": "flat",
  "confidence": 0.81,
  "reason_codes": ["rolling_trend_flat", "no_improvement_after_intervention"],
  "previous_action": "continue_breathing",
  "elapsed_intervention_sec": 60,
  "previous_stage": "guided_breathing",
  "recent_decisions": [
    {"action": "continue_breathing", "state_class": "activated"},
    {"action": "slow_down", "state_class": "settling"}
  ]
}
```

Session仅保存最近3次阶段决策或动作变化的`action / state_class`。每秒重复同一动作不会挤掉历史；缓存命中的相同决策也不重复记录。历史仅在会话内存在，重置即清空，不做长期画像或数据库。真实模型可用历史判断是否重复无效动作；mock在未响应且上次为grounding时切换natural breathing。

### 模型输出和校验

Provider返回原始JSON文本，控制器统一解析。模型不生成stage，由action确定stage，因此无法提交相互矛盾的stage/action。

```json
{
  "action": "switch_to_grounding",
  "inhale_sec": 0,
  "exhale_sec": 0,
  "visual_intensity": 0.42,
  "audio_intensity": 0.35,
  "message": "不用控制呼吸，先听一会儿声音就好。",
  "reason": "连续一轮没有明显趋稳，先降低任务感。"
}
```

七种action与Phase 2一致。continue_breathing/slow_down映射guided_breathing，reduce_stimulation映射settling，natural_breathing/grounding映射switch_method，fade_out/end映射同名stage。最后仍序列化为原有RitualDecision，WebSocket schema维持**1.1**，顶层及子字段均未改变。FastAPI应用版本单独升级为1.2.0。

校验拒绝重复JSON key、非JSON/围栏、缺失或额外字段、未知action、字符串冒充数值、非有限数和超范围值。引导吸气限3–5秒、呼气4–7秒且不少于吸气；非呼吸动作时长必须为0。end/fade_out必须请求零强度，渐退曲线由确定性逻辑执行。message最多25字符、reason最多80字符，保守地限制为中文提示与标点，并过滤医疗/药物/睡眠结论、脑区解释、强迫和屏息用语。

文字过滤是工程防线，不是完整的医学语义证明；当前仅用于合成数据演示。所有模型输出都是不可信输入，不能因通过JSON校验就作为医学证据。

### 硬规则和 fallback

1. **先检查硬规则**：discomfort立即end；已困倦报告使用规则短路径；baseline未满、已在fade_out/end、达到最长会话时长都不调用模型。ready_to_disengage必须有confidence≥0.65、连续两窗口与退出理由证据才直接fade_out；证据不足先按stable处理。
2. **异步请求**：服务器中`decide`立即返回规则输出，Provider在后台生成；不阻塞1Hz推送。每30秒最多一次请求，等待时不重复发起，也不自动重试。下一次取帧时应用已验证的结果。
3. **返回后再校验当前状态**：模型返回时如果用户已不适、已准备退出或场景已重置，取消/丢弃旧结果；不得重新启动呼吸任务。已经settling/switch_method或未响应时不接受继续呼吸训练。
4. **任何失败自动回退**：解析/字段/语义校验失败、服务错误、超时、缺少配置都采用当时的RuleBasedController，不把模型异常送到WebSocket。`LLM_TIMEOUT_SEC`为整次调用期限，默认3秒，可设0.05–10秒；没有每秒重试风暴。

服务器使用非阻塞调度；离线同步调用LLMController.decide时会等待有上限的请求完成。使用者应在FastAPI事件循环中使用当前Session路径，不要在其他异步入口自行包装阻塞调用。

`GET /api/controller`提供演示诊断：mode、source、calls、successes、failures、last_error。source区分rule/safety/pending/mock_llm/llm/fallback，前端无需消费；统计随session重置。日志仅记录错误类型，不记录Key、请求体或模型原文。Key从不进入WebSocket或诊断响应。

### Phase 3 验证

```bash
python -m pytest -q
python scripts/test_phase3_live.py
```

`test_phase3_live.py`自行在空闲loopback端口启动独立Uvicorn服务，约45秒并行验证五个用例，每个45帧：rule、mock_llm、llm本地HTTP协议成功响应、llm超时、llm未配置；同时验证不适立即响应与WebSocket停止。测试完成关闭服务。它会真实走HTTP适配器，但**本地协议Stub不是外部大模型**，不会使用你的Key或对供应商发请求。

接入真实供应商后，可启动llm模式并运行`python scripts/test_ws.py --scenario not_responding --samples 70`，随后检查`GET /api/controller`中successes和source。messages、source与结构化结果共同用于确认真实调用；仅有持续帧或正常动画不能证明调用了模型。

框架参考：[FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)。

## Phase 3.5：Frontend Control Protocol v2

```text
Simulator → State Engine → State Classification → Hard Safety Rules
                                                    ↓
                                      Rule / LLM Controller
                                                    ↓
                                             RitualDecision
                                              /          \
                                   原有Frame v1.1    Visual Control Mapper
                                          ↓                ↓
                                     /ws/state       ControlFrame v2.0
                                                           ↓
                                                      /ws/control
```

| 接口 | 用途 | 消息形态 |
|---|---|---|
| `/ws/state` | 既有前端、Phase 1–3 调试与兼容 | 原Frame v1.1，顶层及子字段不变 |
| `/ws/control` | 新前端直接执行完整视觉目标和引导 | `agent.control / 2.0`，带会话与序列号 |
| `/ws/control?debug=false` | 不展示信号/状态仪表的控制流 | 省略payload.signals和payload.state，其余完整 |
| `/api/schema/control` | 获取后端v2输出契约 | 与docs/agent-control-v2.schema.json一致 |

两条WebSocket可同时连接，建立后立即发送，此后约1Hz，UTF-8 JSON完整快照，无订阅、ACK或JSON Patch。同一个连接不混发版本。默认v2保留模拟信号和三项状态指标；关闭debug时真正省略它们，不发送null或虚构零值。debug不是权限或隐私隔离机制。

### 映射与艺术表达

`backend/visual/mapper.py`只接收加工后的arousal/stability/trend/state_class、阶段和有限动作及呼吸时长；不读原始信号、不调用LLM，也不使用LLM给出的visual_intensity作为shader参数。相同输入及明确的淡出起点/进度得到相同输出。

基础强度为`0.16 + 0.64 × arousal`，settling/switch_method或reduce_stimulation乘0.55，slow_down乘0.8；稳定程度控制噪声和湍动，下降趋势降低流动速度。呼吸引导偏向pulse，声音关注偏向ripple，低刺激阶段偏向serenity；高强度且不稳定的候选可使用storm或fold。选择组合考虑动作、阶段和连续数值，**不将state_class与模式一一绑定**。并非每条demo轨迹都会出现全部五种模式。

除hue为0–360、transition_sec为0.1–15秒外，所有视觉数值均在0–1。`frequency`是纹理密度，**不是Hz**；`pulse`是收缩幅度，前端用guidance的inhale/exhale计算节拍。非guided_breathing阶段必须0/0，含义是自然呼吸。

`backend/control/adapter.py`保存会话投影：每个模拟秒观察一次，在fade_out入口冻结上一帧完整视觉目标，然后按原控制器10秒淡出时长逐步缩小各能量参数，模式和色相保持。即使无人连接或只连接v1，重新接入v2也看到同一淡出进度，不重新开始。end/discomfort时intensity/noise/speed及其他能量参数归零；前端仍需按文档优先处理end并清除人工动画覆盖。transition_sec是前端平滑时间，本后端不实现GPU插值。

visual是艺术化交互控制，不能解释为真实脑区活动、情绪诊断、入睡或生理改善的证据。预设模拟信号不受视觉选择反向驱动。

### v2完整快照

以下数值仅说明字段，timestamp实际使用当前UTC Unix秒：

```json
{
  "type": "agent.control",
  "version": "2.0",
  "session_id": "session-e73f656c-15b0-426d-b0c7-c3070cf99e22",
  "seq": 42,
  "timestamp": 1789016400.125,
  "data_source": "simulated",
  "payload": {
    "visual": {
      "mode": "ripple", "intensity": 0.52, "noise": 0.24, "speed": 0.32,
      "deformation": 0.56, "frequency": 0.46, "turbulence": 0.16,
      "particle_density": 0.38, "particle_spread": 0.30,
      "line_density": 0.48, "line_activity": 0.38,
      "glow": 0.55, "pulse": 0.24, "hue": 193, "transition_sec": 2.5
    },
    "guidance": {
      "text": "不用刻意用力，让呼气稍微长一点。",
      "stage": "guided_breathing", "inhale_sec": 4, "exhale_sec": 6
    },
    "signals": {"heart_rate": 78, "resp_rate": 12},
    "state": {"arousal": 0.5, "stability": 0.7, "trend": "down"}
  }
}
```

### 会话、顺序和前端连接

每次POST /api/demo重置都会生成`session-<UUIDv4>`，同时清空v2计数与淡出起点；进程重启也生成新ID。同一共享会话内，v2每次发送前分配一个seq，从0开始递增，限定为JavaScript安全整数。v1读取不占用序号。多v2客户端共享计数，所以每条连接的seq可有间隔；发送失败也可能消耗一个序号。重连沿用当前会话计数，不从0重放。达到安全整数上限需重置，不循环复用。

data_source枚举为simulated/sensor/mixed/unknown。Phase 4A按当前有效字段来源选择simulated或mixed；当前没有两路外部信号，不能输出sensor。timestamp是每次推送的当前UTC秒，包括end后持续推送；前后端应同步时钟，前端会拒绝超过15秒的旧帧或未来超过5秒的帧。

前端可将其已有AgentClient地址设置为`ws://127.0.0.1:8000/ws/control`。最小接收示例：

```javascript
const socket = new WebSocket('ws://127.0.0.1:8000/ws/control');
socket.onmessage = ({data}) => {
  const packet = JSON.parse(data);
  // 正式前端使用自己的schema、session/seq顺序及时间戳校验。
  console.log(packet.session_id, packet.seq, packet.payload.visual, packet.payload.guidance);
};
```

本服务仍是单进程共享demo，需一个worker；不提供鉴权或公开多用户会话。REST CORS不是WebSocket身份校验。HTTPS前端使用团队WSS代理，本次未部署代理或测试目标浏览器渲染。

### 联调与协议核验范围

本次依据用户提供的`AGENT_INTERFACE.md` v2.0实现。收到的目录没有文档提到的`public/agent-control.schema.json`、`lib/agent-protocol.ts`或`examples/agent_mock.py`，因此未宣称与前端实际Zod/schema文件逐项比对。后端schema是完整输出快照契约：所有视觉字段均提供，比文档允许省略部分视觉参数的接收端要求更严格；含end归零与呼吸时长的跨字段约束。

```bash
python -m pytest -q
# 已启动后端：仅接收，不重置
python scripts/test_control_ws.py --samples 10
# 重置到指定场景并打印会话/序列/模式/强度/阶段/引导
python scripts/test_control_ws.py --scenario already_sleepy --samples 55
# 自行启动三个独立本地服务，约90秒并行校验三场景
python scripts/test_control_ws.py --local --quiet
# 对已有服务串行校验三场景，约3分10秒，会重置共享会话
python scripts/test_control_ws.py --verify --quiet
# 获得前端schema后，对每帧追加前端契约校验
python scripts/test_control_ws.py --local --quiet --frontend-schema /path/to/public/agent-control.schema.json
```

脚本需requirements-dev.txt中的jsonschema，仅为开发测试依赖；运行服务无新增依赖。真实网络测试逐帧校验schema、64KiB上限、UTC新鲜度、会话及递增序列，同时接收v1验证兼容，再检查重置、不适停止和debug=false。合成轨迹验证工程行为，不代表入睡效果。

## Phase 4A：Sensor Adapter与混合输入

```text
                        SensorAdapter
                       /             \
          SimulatorAdapter       MixedAdapter
          HR + Resp模拟          /           \
                   ExternalHeartRateAdapter   SimulatorAdapter
                   HTTP缓冲中的外部HR           Resp模拟
                       \             /
                       SignalFrame
                 数值 + timestamp + field_sources
                            ↓
                       State Engine
                            ↓
               原分级 / 硬规则 / Rule或LLM
                            ↓
                      原Visual Mapper
                            ↓
             /ws/state v1.1 / /ws/control v2.0
```

新增模块：`backend/sensors/base.py`定义接口及输入模型，`adapters.py`封装原Simulator并组合字段，`external.py`管理外部心率缓存/校验/TTL，`backend/api/sensor.py`提供输入和状态REST。未改变三场景轨迹、State Engine公式、分级、控制器或视觉映射规则，无新增依赖。

### 模式配置

```powershell
$env:SENSOR_MODE = 'mixed'          # 默认 simulated
$env:EXTERNAL_HR_TTL_SEC = '5'      # 默认5秒，允许0.5–60秒
$env:CONTROLLER_MODE = 'rule'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

恢复纯模拟只需设置`SENSOR_MODE=simulated`并重启；macOS/Linux使用同名export变量。配置只在启动时读取，POST /api/demo只重置场景/会话，不改变模式。`.env.example`依旧不自动加载。

| SENSOR_MODE | HR | Resp | 有效data_source |
|---|---|---|---|
| simulated（默认） | 模拟 | 模拟 | simulated |
| mixed，有新鲜外部HR | external | 模拟 | mixed |
| mixed，无有效外部HR | 模拟回退 | 模拟 | simulated |

不支持sensor-only；非法模式会明确拒绝启动。simulated模式也可测试POST校验并保存外部缓冲，但不会把它送入算法；状态接口同时展示缓存状态和实际选中来源。

### 发送外部HR测试值

`POST /api/sensor/heart-rate`：

```json
{"timestamp":1789016400.125,"heart_rate":82}
```

timestamp必须替换成当前UTC Unix秒。可选session_id建议由生产者携带，用于拒绝跨reset迟到的旧会话数据。PowerShell连续发送接口测试值：

```powershell
$status = Invoke-RestMethod http://127.0.0.1:8000/api/sensor/status
1..12 | ForEach-Object {
  $body = @{
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
    heart_rate = 82
    session_id = $status.session_id
  } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/sensor/heart-rate -ContentType 'application/json' -Body $body
  Start-Sleep -Seconds 1
}
```

成功返回`accepted=true`及当前sensor status。这里只是在POST人工构造数值，**不代表已连接真实设备，也不是医学级或经过校准的测量**。原State Engine仍需要两项完整数值，所以不会把缺失呼吸填成零。

### 输入范围、TTL与降级

- HR只接受有限数字30–220次/分，不接受字符串、布尔值、NaN或Infinity。这是本原型入口的工程范围，不是医学正常范围或告警标准。
- 事件时间比接收时刻旧超过TTL、未来超过2秒返回422；未来不超过2秒可入缓冲，但在事件时间真正到达前回退模拟，标记external_not_yet_current。
- session_id不匹配、事件时间早于本次reset、重复或倒序时间戳返回409；无效请求不会覆盖最近有效值。
- 新鲜度同时考虑事件时间的年龄与收到后经过的单调时钟时长；任一超过TTL即失效。系统时钟回退到接收时间之前也回退模拟，原因server_clock_regressed。
- 外部缓存只保留最近有效值；新数据到达自动恢复mixed，缺失或过期自动回到simulated。TTL内允许保持最后值，这表示“仍在有效期内”，不是新测量。
- reset生成新会话、清空外部缓冲和baseline，拒绝旧时间戳复用。未携带session_id时，仅凭时间戳无法区分伪装成新时间的旧会话请求；因此生产者应携带session_id并在reset后重新获取。

来源在SensorReading/SignalFrame的`field_sources`逐字段记录：simulated / external / unknown；Phase 4B进一步支持phone_ppg / apple_watch。汇总为：两路模拟→simulated；一路外部来源一路模拟→mixed；两路外部来源→sensor（仅预留汇总逻辑）；任一unknown→unknown。

### 状态与追溯

`GET /api/sensor/status`不推进模拟时钟或消耗v2序号。返回示例（数值仅示意）：

```json
{
  "mode": "mixed",
  "session_id": "session-...",
  "effective_data_source": "mixed",
  "sensor_status": "active",
  "stale_reason": null,
  "ttl_sec": 5,
  "heart_rate": {"source":"external","fresh":true,"age_sec":0.8,"value":82},
  "resp_rate": {"source":"simulated","fresh":true,"age_sec":0,"value":12},
  "external_heart_rate": {
    "fresh":true,"age_sec":0.8,"stale_reason":null,
    "timestamp":1789016400.125,"received_at":1789016400.2,"heart_rate":82
  },
  "last_consumed": {
    "timestamp":1789016400.9,"heart_rate":82,"resp_rate":12,
    "field_sources":{"heart_rate":"external","resp_rate":"simulated"},
    "stale_reason":null
  }
}
```

heart_rate/resp_rate描述**现在实际选中的输入**，external_heart_rate单独描述外部缓存。过期回退时，选中字段source=simulated且fresh=true，外部缓存fresh=false；sensor_status=fallback，stale_reason=external_expired或external_missing，不会把模拟回退值称为外部实时值。last_consumed是最近一个送入State Engine的完整SignalFrame；尚未采样时为null。

POST本身不运行算法。每秒采样一次；同一秒内的WebSocket可展示新缓冲值，但state要等下一个采样点，不能把多客户端读数当作多个新样本。当前快照的signals与data_source对应同一次Adapter读取。State Engine最迟180秒停止推进，之后仍更新信号来源/TTL，但不更新state或重启仪式。

缺失历史样本不补造外部测量：会话追赶漏过的模拟秒时，不把新到HR回填到其接收/事件时间之前。历史缺口使用模拟值，SignalFrame记录external_unavailable_at_tick等原因。现有baseline和rolling window可能同时含模拟与外部样本，切换来源本身会影响指数；本阶段保持公式不变，不将这种变化解释为身体改善。

### Adapter扩展约定与兼容性

统一接口为`SensorAdapter.read(second, timestamp, *, now=None)`，返回SensorReading；单字段Adapter可返回部分读数，MixedAdapter组装为必须同时包含HR/Resp的SignalFrame后再调用原Signals模型。这是非阻塞的同步缓冲读取，保留现有Session的确定性推进方式。未来硬件应由异步生产者填充缓冲；不要在read内做网络、BLE或设备等待。

v1.1/v2.0 schema、顶层与子字段不变。v2仅填入已有data_source枚举的实际值，debug=true展示当前选中信号，debug=false仍省略信号。为避免REST误报，`/health`与`/api/demo`的既有data_source也动态返回有效来源；DemoStatus的REST枚举扩大，但默认模拟响应保持原值。字段级来源与缓存信息只通过新增REST暴露，不向前端快照加字段。

仍为单进程、单共享会话，无设备认证、来源真实性验证、医疗校准、数据库或多用户隔离。external标签仅说明来自外部HTTP输入；本阶段没有接Apple Watch、Wear OS、BLE、手机PPG、真实呼吸或HRV。

### 验证

```bash
python -m pytest -q
# 自动启动simulated与mixed两个本地服务（测试TTL=2秒），约25秒
python scripts/test_sensor_ws.py --local
# 对已有mixed服务测试，需设置EXTERNAL_HR_TTL_SEC=2并重启；会重置会话
python scripts/test_sensor_ws.py --mode mixed --base-url http://127.0.0.1:8000
```

该脚本实际POST人工HR，经State Engine后同时校验v1/v2消息，覆盖输入更新、断流、回退、恢复、无效时间戳和reset。它不连接任何真实设备。旧的demo轨迹脚本应在SENSOR_MODE=simulated下运行。

## Phase 4B：手机PPG前后短测

```text
手机后置摄像头 + 闪光灯（用户授权）
              ↓
tools/ppg-demo：中心ROI RGB均值，约25秒
              ↓
POST /api/sensor/ppg：去趋势、主频估计、质量门控
              ↓ 有效读数
同一accept_heart_rate / ExternalHeartRateAdapter
              ↓
HR=phone_ppg，Resp=simulated → data_source=mixed
              ↓
原State Engine → Controller → Visual Mapper → /ws/control
```

PPG利用光学强度的周期变化估算心率。本原型输出BPM及工程signal_quality，不测HRV或呼吸率，也不判断疾病、睡眠阶段、真实脑活动或疗效。实现依据与阈值、隐私和已知限制见[手机PPG实现与验收](docs/PHONE_PPG.md)。

启动`SENSOR_MODE=mixed`后打开`/tools/ppg-demo/`。手机需要可信HTTPS、可用后置摄像头和torch控制；不是所有普通手机/浏览器都支持。桌面localhost页面可用于检查界面，但不能代替手机实测。先新建会话并完成约25秒前测，再连接正式视觉前端；结束前预留约25秒后测。不要为后测reset会话。发热或不适立即停止。

工具不重写正式前端，不上传视频，只提交颜色均值序列。后台质量不足时返回valid=false、heart_rate=null和failure_reason，不写入缓存或summary，页面提示重测；质量通过才记录phone_ppg。原HR POST也接受来源/质量/时长/phase元数据，详见上述接口文档。

默认5秒TTL保持原样；前后短测之间自动回退模拟HR，不能将一次读数反复更新时间戳来假装连续监测。`GET /api/sensor/status`展示字段来源、当前新鲜度和回退原因；`GET /api/session/summary`展示pre_ritual_hr/post_ritual_hr、时间、质量、差值及当前来源。历史测量在TTL过期后保留，但reset清空。

只表达“本次体验前后测得的心率发生变化”，不把下降解释为干预有效。由于短测与原baseline/窗口混合，当前也不能称为持续真实生理闭环。

Apple Watch仅完成[原生桥接设计与可选Adapter](docs/APPLE_WATCH.md)，未实接设备：iPhone历史/间歇HealthKit样本不等同于Watch workout中的较高频采样，后续需要官方HealthKit/WatchConnectivity及iOS/watchOS原生开发环境。默认路径不加载Watch Adapter。

```bash
python -m pytest -q
node --test tools/ppg-demo/test_capture.cjs
python scripts/test_ppg_ws.py
```

Python覆盖已知波形、噪声/低质量、混合来源、TTL、前后测与reset；Node使用模拟DOM/摄像头验证独立工具采集与取消；网络脚本发送合成PPG，经真实HTTP和双WebSocket联调。这三者都不是物理手机或Apple Watch实测。原146项测试、默认模拟轨迹及两套WebSocket schema保留。

## Phase 4C：Demo Hardening / Device Acceptance Toolkit

`/tools/ppg-demo/` 增加设备诊断、实采 FPS/时长/质量、接受结果、session 和实时来源/TTL 状态；支持前测 → 文字仪式入口 → 后测 → summary。复用原有接口，未更改核心算法或 v1.1/v2.0 协议。

现场先运行 `python scripts/check_device_acceptance.py --base http://127.0.0.1:8000`，再新建会话完成前测。脚本会打开 WebSocket 并启动共享仪式，不注入心率。
详见 [DEVICE_ACCEPTANCE.md](docs/DEVICE_ACCEPTANCE.md) 的设备步骤、故障矩阵和记录表。

**物理手机仍需手工验收；Apple Watch 仍只有 Adapter/文档。PPG 是非医疗原型，合成 PPG 测试不可作为真实生理验证。**

## PPG 手机校准反馈

首轮物理手机反馈确认摄像头/torch/25秒采集可运行，但尚无稳定 accepted 心率。新增拒绝细项、3/5秒预热对照、ROI统计与本地校准 JSON 导出，另提供 `python scripts/replay_ppg.py 文件.json` 离线复现。运动跳变判据收紧，质量与一致性阈值未放宽。
详见 [PPG_CALIBRATION.md](docs/PPG_CALIBRATION.md)；流程跑通不等于生理测量验证。

## Phase 6 · 决赛演示模式

打开前端 `/roadshow`，或从首页点击“进入决赛演示”。选择今晚状态后一键开始：标准案例60秒；“已经比较困”30秒，省去固定节拍并提前退出。预设模拟信号、解释和动作共用同一时间线，不调用模型、不依赖传感器。

主界面呈现观察、下一步、个人参考比较、状态变化与决策足迹；技术字段/声音设置/未来Sensor入口默认折叠。原首页与后端集成保留，v1.1/v2协议不变。

生产构建：在 frontend 执行 `pnpm build`。测试：`node --experimental-strip-types --test tests/*.test.ts`。完整口播、时间线、截图、易拉宝建议和现场清单见 [ROADSHOW_MATERIAL.md](docs/ROADSHOW_MATERIAL.md)。不包含PPT文件或新部署。
