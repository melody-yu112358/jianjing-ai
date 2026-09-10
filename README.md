# 渐静 jianjing-ai

医疗健康黑客松 **backend MVP**：模拟身体信号 → State Engine → 规则状态机 → WebSocket → 前端可消费的实时 JSON。

Python 3.11+ / FastAPI。当前完全使用合成数据，不接 LLM、HRV、真实硬件、数据库或登录，不包含正式前端。命令行接收器用于联调。

**`arousal` 和 `stability` 是用于交互控制的 prototype state index，不是医学诊断指标，也不能判定真实脑区活动、入睡或疗效。** 模拟轨迹按时间预设，不是控制器真实改变了身体；本版验证接口与决策分支。

## 目录

```text
jianjing-ai/
├── backend/
│   ├── main.py                # FastAPI入口、REST、CORS
│   ├── models.py              # 唯一消息模型与输入枚举
│   ├── session.py             # 共享会话、重置、时间推进
│   ├── sensors/simulator.py   # 合成轨迹插值
│   ├── state/arousal.py       # baseline与rolling window
│   ├── ritual/controller.py   # 阶段规则与输出
│   └── api/websocket.py       # /ws/state
├── data/
│   ├── demo_calming.json
│   └── demo_not_responding.json
├── docs/state.schema.json     # 可交给前端的JSON Schema
├── scripts/test_ws.py         # 实际网络接收与双场景验证
├── tests/test_backend.py      # 完整轨迹及接口回归测试
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
```

跨平台 curl：

```bash
curl -X POST http://127.0.0.1:8000/api/demo -H 'Content-Type: application/json' -d '{"scenario":"calming","self_report":"mind_racing"}'
```

请求：`scenario` 必填，只能是 `calming` 或 `not_responding`。`self_report` 可省略或为null，使用场景预设；提供时只能是：

| self_report | 交互含义 | 初始arousal |
|---|---|---|
| mind_racing | 思绪停不下来 | 0.78 |
| body_tense | 身体紧绷 | 0.74 |
| tired_but_awake | 疲惫但仍清醒 | 0.62 |
| already_sleepy | 已有困意 | 0.38 |

未知场景、未知报告或多余字段返回HTTP 422，不重置已有会话。修改self_report也需调用同一POST并重新建立baseline，不支持中途隐式改变参考。

POST返回与 `GET /api/demo` 相同：

```json
{"scenario":"calming","self_report":"mind_racing","generation":2,"data_source":"simulated","schema_version":"1.0","scope":"shared_process"}
```

`generation` 每次重置加1。为保持指定的WebSocket字段不变，模式、版本和generation放在REST状态中。前端应显示“模拟数据”；如允许其他操作者切换，可轮询GET检测generation变化。该MVP没有鉴权，应仅用于本地或可信演示网络，不能作为公开多用户服务部署。

## Simulator

JSON文件提供时间关键点，逐秒线性插值，加确定性的正弦微扰；同一场景与时刻输出可复现，无随机种子依赖。

- `calming`：前10秒约86次/分心率、16次/分呼吸；之后逐步降至约70与10，微扰逐渐减小。
- `not_responding`：从相同身体信号开始，随后略升至约90与17.5，微扰不减小。
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

## Rule-based Ritual Controller

控制器只看self_report、状态及经过时间，**不读scenario名称**。初次baseline就绪时退出assess，之后每30秒决策一次；动画参数每秒计算。阶段如下：

| 阶段 | 进入或离开条件 | 呼吸秒数 |
|---|---|---|
| assess | 等待10个baseline样本；already_sleepy随后直接settling，其他进入guided_breathing | 0 / 0 |
| guided_breathing | 下一决策点：trend=down且stability≥0.5进入settling，否则switch_method | 4 / 6；body_tense为4 / 5 |
| settling | arousal≤0.35、stability≥0.65且trend非up时进入fade_out；trend=up或stability<0.4则switch_method | 0 / 0 |
| switch_method | 使用自然呼吸与声音关注；后续trend=down且stability≥0.5才进入settling | 0 / 0 |
| fade_out | 从进入时强度线性渐弱10秒，随后end；任何未结束会话最迟170秒进入淡出 | 0 / 0 |
| end | 终态，无需达到平静目标；不会自动重启 | 0 / 0 |

0 / 0 表示“无需定时吸呼”，不是屏息；前端不能用它计算除法或呼吸频率。消息避免宣称已入睡。180秒后保持最终signals/state，继续每秒推送end帧与新的timestamp，visual全0，直到断开或POST重启。这使前端无需将正常结束与网络故障混淆。

## WebSocket 消息契约 v1.0

连接后立即推送一帧，以后约每秒一帧UTF-8 JSON文本。不需要发送订阅消息；当前通道只提供服务端推送，命令通过REST。实际网络调度可有轻微偏差，不保证硬实时。慢客户端可能跳过中间样本，但状态引擎按经过秒数补算，单会话最多181个样本。

```json
{
  "timestamp": 1789000000.123,
  "signals": {"heart_rate": 86, "resp_rate": 15},
  "state": {"arousal": 0.72, "stability": 0.41, "trend": "down"},
  "ritual": {"stage": "guided_breathing", "inhale_sec": 4, "exhale_sec": 6},
  "visual": {"intensity": 0.70, "noise": 0.62, "speed": 0.68},
  "message": "先不用努力睡着，只把呼气稍微拉长一点。"
}
```

以上为字段示例，非特定时刻计算结果。所有字段必填且不为null，不增加顶层字段。

| 字段 | 类型与单位 | 解释 |
|---|---|---|
| timestamp | number，Unix UTC秒 | 推送时刻；JS使用`new Date(timestamp * 1000)`；非相对时间 |
| signals.heart_rate | number，次/分，>0 | 当前合成心率 |
| signals.resp_rate | number，次/分，>0 | 当前合成呼吸频率，不是引导目标 |
| state.arousal | number，[0,1] | 原型唤醒指数 |
| state.stability | number，[0,1] | 原型窗口稳定度 |
| state.trend | down / flat / up | 唤醒指数相对10秒前趋势 |
| ritual.stage | 六阶段枚举 | 当前控制阶段 |
| ritual.inhale_sec / exhale_sec | number，秒，≥0 | 提示节奏；0代表自然呼吸 |
| visual.intensity / noise / speed | number，[0,1] | 无量纲动画参数，不是脑活动或物理速度 |
| message | string | 当前中文提示 |

常规强度为`(0.2 + 0.65 * arousal)`，settling/switch_method乘0.65；fade_out使用进入时强度渐退。`noise=(1-stability)*intensity`，`speed=(0.2+0.8*arousal)*intensity`，全部clamp。end三项为0。前端可平滑插值，但不可把视觉变平静宣称为实测疗效。

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
python -m pytest -q
```

CLI每次会先POST重置共享会话，避免跟其他演示同时运行。`--verify`串行采集两场景各45帧（约88秒），校验每帧schema、递增时间戳、平均1秒推送，以及calming的arousal下降超过0.2并进入settling、not_responding进入switch_method。成功返回退出码0，失败返回非0。

单元测试无需等待180秒，直接推进完整轨迹，覆盖四种self_report、baseline固定、滑动窗口、不同阶段、渐退和结束、重复读帧、长时间无人连接、输入校验、schema一致性、断开重连、活动连接场景重置和CORS。网络CLI补充真实Uvicorn和TCP/WebSocket验证。

本次实测结果见[本地验证记录](docs/VALIDATION.md)。

## 开发约束

只修改本后端及契约，前端由队友独立实现。未来真实设备、LLM和医疗验证应另行设计，不能直接把当前演示规则当成医疗判断。

框架参考：[FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/)。
