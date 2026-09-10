# 渐静 jianjing-ai

医疗健康黑客松 **backend MVP**：模拟身体信号 → State Engine → 规则状态机 → WebSocket → 前端可消费的实时 JSON。

Python 3.11+ / FastAPI。第二阶段增加可解释分级、统一控制器接口与已困倦场景，当前完全使用合成数据，不接 LLM、HRV、真实硬件、数据库或登录，不包含正式前端。命令行接收器用于联调。

**`arousal` 和 `stability` 是用于交互控制的 prototype state index，不是医学诊断指标，也不能判定真实脑区活动、入睡或疗效。** 模拟轨迹按时间预设，不是控制器真实改变了身体；本版验证接口与决策分支。

## 架构与职责

```text
Sensor / Simulator
       ↓
State Engine
       ↓
State Classification
       ↓
Ritual Controller
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
│   ├── ritual/controller.py   # 统一接口、规则实现、LLM占位
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

`generation` 每次重置加1。为保持指定的WebSocket字段不变，模式、版本和generation放在REST状态中。前端应显示“模拟数据”；如允许其他操作者切换，可轮询GET检测generation变化。该MVP没有鉴权，应仅用于本地或可信演示网络，不能作为公开多用户服务部署。

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

`LLMController`只保留同一接口与返回类型，调用会明确抛出NotImplementedError；没有依赖SDK、网络请求或后台模型调用。未来实现仍须返回同一RitualDecision并通过校验，不得自由增加字段或医疗建议。决策schema见[ritual-decision.schema.json](docs/ritual-decision.schema.json)。

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

0 / 0 表示“无需定时吸呼”，不是屏息；前端不能用它计算除法或呼吸频率。消息避免宣称已入睡。180秒后保持最终signals/state，继续每秒推送end帧与新的timestamp，visual全0，直到断开或POST重启。这使前端无需将正常结束与网络故障混淆。

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

常规强度为`(0.2 + 0.65 * arousal)`，settling/switch_method或slow_down动作乘0.65；fade_out使用进入前一帧的强度渐退。`noise=(1-stability)*intensity`，`speed=(0.2+0.8*arousal)*intensity`，全部clamp。当前audio_intensity与视觉强度相同，end均为0。前端可平滑插值，但不可把视觉变平静宣称为实测疗效。

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

只修改本后端及契约，前端由队友独立实现。未来真实设备、LLM和医疗验证应另行设计，不能直接把当前演示规则当成医疗判断。

框架参考：[FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)。
