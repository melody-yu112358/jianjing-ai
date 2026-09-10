# 后端 Agent → 渐静前端：控制接口 v2.0

后端负责：实时生理信号采集/分析、选择引导词、选择视觉模式并输出动画控制参数。
前端负责：校验与接收控制快照、呈现引导词、GPU 动画与平滑过渡、人工调试、断连恢复。

前端没有情绪诊断模型，不会基于心率自行覆盖 Agent 的控制参数。Agent v2 可以只发引导词和视觉控制，不必传原始生理数据。旧后端的 `/ws/state` v1.0 完整帧也继续支持。

## 传输

- WebSocket UTF-8 JSON 文本。建议每秒发送 1–5 个完整快照，最多每 2 秒发送一次，以免触发 5 秒无有效帧超时。
- 新 Agent 建议路径 `/ws/control`；页面支持输入任意 WS 路径。旧后端路径仍是 `/ws/state`。
- 连接建立后后端主动推送，不需要订阅指令，不发送确认或控制指令回后端。
- HTTPS 前端需要 WSS。后端自行处理身份验证与 Origin 校验；REST CORS 不提供 WS 身份验证。
- 本原型未实现登录凭据输入。生产鉴权可使用同站安全 Cookie 或团队已有代理；不要在 URL 里放长期 API key。
- 最大单条消息 64 KiB。使用当前 UTC Unix 秒时间戳。收到时超过 15 秒的旧消息、未来超过 5 秒的消息被拒绝；前后端应同步系统时钟。
- 在持续推送期间，一条消息必须包含完整的 `visual` 基础字段和 `guidance`。不是 JSON Patch。可选视觉字段缺省会重新使用默认映射，不继承上帧残留值。

## 完整控制快照示例

```json
{
  "type": "agent.control",
  "version": "2.0",
  "session_id": "session-20260910-001",
  "seq": 42,
  "timestamp": 1789016400.125,
  "data_source": "sensor",
  "payload": {
    "visual": {
      "mode": "ripple",
      "intensity": 0.52,
      "noise": 0.24,
      "speed": 0.32,
      "deformation": 0.56,
      "frequency": 0.46,
      "turbulence": 0.16,
      "particle_density": 0.38,
      "particle_spread": 0.30,
      "line_density": 0.48,
      "line_activity": 0.38,
      "glow": 0.55,
      "pulse": 0.24,
      "hue": 193,
      "transition_sec": 2.5
    },
    "guidance": {
      "text": "不用刻意用力，让呼气稍微长一点。",
      "stage": "guided_breathing",
      "inhale_sec": 4,
      "exhale_sec": 6
    }
  }
}
```

示例 timestamp 仅用于说明单位，实际发送必须换成 `time.time()` / `Date.now()/1000`。`data_source` 是后端的来源声明，不是前端对设备真实性的认证；可选值 simulated / sensor / mixed / unknown。

`payload.signals` 和 `payload.state` 均可省略。若需要显示仪表，分别添加：

```json
{"signals":{"heart_rate":78,"resp_rate":12},"state":{"arousal":0.5,"stability":0.7,"trend":"down"}}
```

这两个字段缺省时对应仪表显示“—”，不会补造生理数据；visual 和 guidance 正常工作。唤醒/稳定度只显示和记录，v2 的视觉参数不会被它们重算。

## 五种形态

| mode | 基础空间形态 | 同一模式内的连续变化 |
|---|---|---|
| serenity | 饱满水体、微弱连续波纹、稀疏光点与轻柔流线 | 可调水波高度、疏密与交叠 |
| ripple | 沿球面传播的同心涟漪 | 可调波高、疏密、传播速度、相位扰动 |
| fold | 方向交错的连续水波 | 可调浪高、波纹密度与传播速度 |
| storm | 多方向传播的交叠浪峰、外扩粒子和活跃流线 | 可从低幅水波到较强浪涌，球体主体轮廓始终保留 |
| pulse | 呼吸感收缩舒张与低频环形起伏 | 可调脉动幅度、表面扰动、粒子扩散与线条变化 |

模式是视觉表达方式，不是情绪诊断标签。模式切换使用权重连续混合，不会替换整个场景。

## visual 参数表

| 参数 | 范围 | 必填 | 作用 |
|---|---|---|---|
| intensity | 0…1 | 是 | 总体形变能量、场景淡出可见度；0 最终完全隐藏 |
| noise | 0…1 | 是 | 低幅交叠水波 |
| speed | 0…1 | 是 | 场景动画时钟推进速度；0 停止自身流动 |
| mode | 上表枚举 | 否 | 形变模式；缺省由旧版三个视觉参数选择 |
| deformation | 0…1 | 否 | 表面水波高度，受 intensity 总体调制 |
| frequency | 0…1 | 否 | 表面水波密度，不是生理频率或 Hz |
| turbulence | 0…1 | 否 | 浪涌中的连续交叠波强度，不产生切向扭曲 |
| particle_density | 0…1 | 否 | 外围可见粒子比例；0 隐藏粒子 |
| particle_spread | 0…1 | 否 | 粒子和外围流线离开球面的距离 |
| line_density | 0…1 | 否 | 可见表面/外围流线比例；0 隐藏线条 |
| line_activity | 0…1 | 否 | 线条流动亮度与局部扰动活跃度 |
| glow | 0…1 | 否 | 边缘辉光及线条亮度 |
| pulse | 0…1 | 否 | 整体舒张收缩幅度；有呼吸引导时跟随引导节拍 |
| hue | 0…360 | 否 | 色相，0 与 360 均为红色附近；不用于诊断 |
| transition_sec | 0.1…15 秒 | 否 | 常值目标约达到 95% 变化量所需时间，缺省取模式预设 |

默认值与模式预设的唯一代码入口为 `lib/visual-controls.ts`。`serenity`、`ripple`、`fold`、`storm`、`pulse` 均有完整预设；UI 的模式快捷按钮加载预设，形态下拉框只改变模式，保留其余调节值。

指数平滑 `alpha = 1 - exp(-dt/(transition_sec/3))`。色相先转换为颜色再平滑混合。除绘制所需的默认补齐和平滑外，不改写后端的显式控制。用户开启“轻柔动效”时，将形变、混乱、扩散、线条活跃和速度降低到较柔和范围；这是用户可见的本地偏好。

## guidance 与阶段

`text` 必填，可为空字符串以清空提示，最长 4000 字符。前端作为纯文本显示，不执行 HTML。`stage` 支持 assess / guided_breathing / settling / switch_method / fade_out / end。

`inhale_sec` / `exhale_sec` 范围 0…60 秒，必须同时为正数或同时为 0。只有 guided_breathing 允许非零节拍；其余阶段必须为 0/0。0/0 表示自然呼吸，不是屏息。end 要求 intensity/noise/speed 全为 0，其他可选视觉配置可以保留但不可使画面重新出现。

## 人工 / Agent 控制权

- 连接 Agent 后，动画和引导词均跟随其有效快照。
- 拖动动画参数或选择模式 → 只接管动画。连接保持，后端的引导词、呼吸节奏和可选仪表仍更新。
- 点击“交给 Agent” → 平滑回到最新有效视觉控制。只有 Agent 数据新鲜时可交回。
- Agent 发 end → 优先执行结束，清除人工动画覆盖。不会被下一次人工拖动复活。
- 切回模拟是显式操作，会断开 Agent。手动“断开”则保持等待状态，不自动生成模拟数据。
- 失联时 Agent 引导停止，Agent 控制画面逐步变淡；若已经人工接管，人工动画仍可独立使用，界面明确提示后端失联。

## 顺序、会话与恢复

- `seq` 为当前 session 内单调递增非负安全整数；重复或倒序丢弃，不刷新有效数据时间。
- 新 session_id 可从 seq=0 开始，并清空趋势窗口。已退出会话的晚到消息不能再次接管。
- 每次用户显式连接会清空协议顺序跟踪；自动重连保留顺序跟踪，防止重放旧帧。
- 同一次连接选择一种协议，不混发 v1 / v2。
- 10 秒未收到首次有效控制、5 秒未收到后续有效控制、连接关闭或错误，均尝试自动重连。
- 失败重试间隔 1 / 2 / 4 / 8 / 10 秒，连续 5 次后停止；收到新有效帧重置重试计数。人工断开取消所有重试。
- 不另定义心跳消息。底层 WS ping/pong 不能代替有效控制快照；Agent 需要定期发送最新快照。
- UI 显示有效帧数、拒绝数、重试状态和错误原因，不自动切换模拟掩盖故障。

## 可直接使用的实现入口

- `lib/agent-protocol.ts`：Zod v2 协议、v1 适配、序号/会话过滤、控制权合成。
- `lib/agent-client.ts`：与 React 无关的 WebSocket 客户端，回调 `onFrame(packet, reset)`、`onState(snapshot)`。
- `lib/visual-controls.ts`：模式、范围、默认映射。
- `components/particle-field.tsx` + `lib/soft-sphere-shaders.ts`：统一柔性表面、GPU 粒子与流线。
- `public/agent-control.schema.json`：可供 Python / 其他后端校验的 JSON Schema。
- `examples/agent_mock.py`：独立模拟 Agent，演示五种模式和引导文本。

联调示例：安装 `websockets` 后执行 `python examples/agent_mock.py`，本地前端连接 `ws://127.0.0.1:8765/ws/control`。在线 HTTPS 页面需使用团队配置的 WSS 代理。该示例只用合成参数，不能替代真实 Agent 的生理分析。

## 验证范围

已通过 15 项协议/控制权/重连与回放事件测试、TypeScript 类型检查和生产构建。已实测 Python 模拟 Agent 经真实本机 WebSocket 向 AgentClient 发送五种模式与五条引导词，不附带生理数据也能成功接收。测试入口为 `python tests/run-ws-smoke.py`，两端运行于同一网络命名空间。

尚未进行目标浏览器的视觉/帧率验收、线上 WSS 代理测试、真实传感器或实际 Agent 的闭环测试。模式与形变的艺术效果及舒适程度仍需在目标设备上确认。

## v3 网页：40 秒回放与入睡事件（兼容 v2.0 消息）

内置演示每 250 ms 生成一条完整 `agent.control` 快照，经同一 `decodeControl` 和 `ControlOrder` 校验后进入与实时 Agent 共用的 `applyPacket` 接收函数。模拟传输发生在浏览器内，无需运行后端；没有绕过接口直接改动画。时间戳为演示起点的 UTC Unix 秒加虚拟播放秒数，暂停冻结虚拟时间，恢复不重置序号；实时 WebSocket 仍执行当前墙钟新鲜度校验。

| 时间 | 画面 / 引导 |
|---|---|
| 0–8 秒 | 湍动、暖铜珠光、大幅形变；觉察当下 |
| 8–16 秒 | 紫色柔性褶皱；4 秒吸气 / 6 秒呼气 |
| 16–25 秒 | 青色涟漪逐渐放缓；释放肩膀紧绷 |
| 25–34 秒 | 稀疏光点、宽缓球面；自然呼吸 |
| 34–40 秒 | 模拟入睡事件；停止引导，球与光点归拢、环形余光淡出 |

这是压缩的叙事演示，不表示用户会在 40 秒内入睡。模拟心率等曲线仅用于演示。

新增可选 `payload.events`（最多 8 项），入睡由后端 Agent 判断并明确报告：

```json
{"events":[{"id":"sleep-001","type":"sleep_detected","timestamp":1789016434.0,"simulated":true}]}
```

`id` 为 1–128 字符；`timestamp` 为事件发生的 UTC Unix 秒。事件时间晚于当前快照时暂不触发；后端应在后续快照重复携带直到时间到达。接收新鲜快照可携带更早发生的入睡事件。`simulated` 必填；它为 true 或消息的 data_source 为 simulated 时，页面均显示“模拟入睡”。否则显示“后端报告入睡”，不自行依据心率、低唤醒值、播放结束或断线推断入睡。

同一会话只触发一次入睡收束，即使后端重复事件或换一个事件 id。入睡后清除人工覆盖，停止引导、锁定人工动画调节，6 秒内收拢并淡出；后续普通控制快照和自动重连不会重新激活动画。新会话、显式重新连接或重播演示解除锁定。事件保留在页面记录中。

首次触发同时派发浏览器事件，方便上层接入记录或其他本地行为；没有向后端发送 ACK：

```js
window.addEventListener('jianjing:sleep-detected', event => {
  // detail: { id, type, timestamp, simulated, session_id, data_source }
  console.log(event.detail);
});
```

球面从 24,320 增加到 97,792 个三角面（256×192 细分），使用变形后表面的中心差分平滑法线。材质为程序化柔缎珠光：宽幅高光、包裹光与细微珠光色偏。透光感是着色近似，不是物理折射。保留像素比上限与轻柔动效选项；目标设备帧率尚需实测。

新增测试：`node --experimental-strip-types --test tests/mindfulness-demo.test.ts`，覆盖完整时间轨迹的双 Schema 校验、阶段切换、暂停时间、迟到 tick、重播、事件幂等、人工覆盖优先级、模拟标签与网格面数。

## v4 网页：轻盈水体、连续形态过渡与独立特效

材质改为浅色、带柔和内光的水体效果：缓慢细涟漪、Fresnel 反射、深浅水色与半透明表面，移除丝缎颗粒和珠光色带。色彩在浅薄荷、青蓝、柔紫和淡金之间变化，形变与运动承担主要的状态差异。环境反射和透光为程序化近似，未采用真实场景折射。

`transition_sec` 同时控制数值参数的指数平滑和模式变化时长。模式使用五次平滑曲线，在指定时间内从当前显示的混合形态过渡到新模式；同模式的重复快照不重置过渡，快速再次切换从正在显示的混合形态衔接。三层几何共用模式权重及表面。40 秒演示的过渡时长改为 2.8 秒。

粒子及流线继续存在，适当离开球面以保持辨识度。页面提供独立控制区域，后端 `payload.visual` 也支持下列新增可选字段（均为 0…1，旧消息继续兼容）：

| 字段 | 作用 |
|---|---|
| particle_speed | 粒子环绕和漂移速度，0 停止独立漂移 |
| particle_size | 光点尺寸，小到大；隐藏请将密度或亮度设为 0 |
| particle_brightness | 光点亮度，0 隐藏 |
| line_speed | 流线亮度传播和局部运动速度，0 停止独立流动 |
| line_brightness | 流线亮度，0 隐藏 |

原有 `particle_density`、`particle_spread`、`line_density`、`line_activity` 继续有效。`speed` 控制球体表面的运动时钟；新增两个速度控制各自独立的特效时钟，均可与其他参数独立设置。特效停止独立漂移后仍随球面形变。暂停与后端过期停止所有运动时钟；入睡事件仍优先收拢并隐藏全部图层。

```json
{"mode":"serenity","intensity":0.28,"noise":0.05,"speed":0.08,"transition_sec":3,"particle_density":0.3,"particle_spread":0.35,"particle_speed":0.12,"particle_size":0.4,"particle_brightness":0.65,"line_density":0.3,"line_activity":0.1,"line_speed":0.12,"line_brightness":0.5}
```

水波几何更新：移除随机鼓包、切向扭曲与大幅全体脉动。所有形态改用连续传播波，最大设计波幅受限，保持整体球形。旧 `fold` / `storm` / `pulse` 协议值不变，页面分别显示“叠浪 / 浪涌 / 呼吸波”。变化的强弱由浪高、传播速度、交叠及外围特效呈现。

## v5 网页：清透水体与星点背景

默认配色收敛到低饱和冰蓝、银白与淡紫，移除黄绿底色和厚重的整体内光。水体中央透明度明显降低，边缘与浪峰由反射高光呈现；这是程序化反光与 alpha 透光，不是物理折射。后端 hue 仍有效，以更淡的色彩表达。

模式预设过渡调整至 3.8–4.8 秒，40 秒演示采用 4.2 秒；后端显式 transition_sec 仍按指定时间执行。粒子与流线继续接受独立控制，并降低默认尺寸和亮度，避免覆盖水体。

新增全屏稀疏白色星点背景，使用独立 Canvas 绘制，缓慢漂移且只有极轻微亮度变化。它与 Agent 的前景粒子分离，暂停/失联时停止漂移，轻柔动效下保持静止，入睡时变暗。无新增后端字段。参考方向为用户指定的 [OpenAI 官网](https://openai.com/) 星点氛围；未提取官网素材，也未核对其动态效果细节。

验证范围：协议、回放和模式过渡测试，类型检查及生产构建；没有进行浏览器视觉验收。
