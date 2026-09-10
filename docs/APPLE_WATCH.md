# Apple Watch增强路径：桥接设计，未实接

本阶段只提供`AppleWatchHeartRateAdapter`接口及来源标签，没有Watch App、HealthKit权限、配对过程或原生构建产物。当前Windows工作区未进行iOS/watchOS构建，也没有物理Watch验收；不阻塞手机PPG主路径。

## 区分数据类型

| 路径 | 可能得到的数据 | 本后端处理 |
|---|---|---|
| iPhone HealthKit查询历史样本 | 已保存、可能间歇且延迟同步的心率 | 保留原测量时间，超过TTL不当实时输入 |
| Watch上的HKWorkoutSession/LiveWorkoutBuilder | 合适的用户发起workout期间，更高频的心率采样 | 原生桥接将新样本送到同一HR入口 |
| 浏览器页面 | 没有直接HealthKit/WatchConnectivity桥接 | 不能仅靠这个PPG网页读取Watch |

Apple说明workout session可在后台继续获取传感器数据，并产生高频心率样本；这不保证每秒一个值或传输无延迟。[Running workout sessions](https://developer.apple.com/documentation/healthkit/running-workout-sessions)。不能把历史查询或缓存重发包装为连续实时心率，也不要为本睡前demo伪造一段运动记录。

## 后续官方路线

需要Mac/Xcode、Apple签名及iOS/watchOS原生工程。用户授权HealthKit读取心率，Watch侧保留样本endDate及单位count/min；原生iPhone/Watch bridge通过官方WatchConnectivity或合适网络通道转发，跨设备时携带当前session_id。历史/间歇与workout来源要在原生端和路演中分别说明。

[HealthKit](https://developer.apple.com/documentation/healthkit)、[WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity)、[HKWorkoutSession](https://developer.apple.com/documentation/healthkit/hkworkoutsession)是后续实现依据；本仓库不使用私有协议。

## 后端契约

```json
{"timestamp":1789016400.125,"heart_rate":78,"source":"apple_watch","session_id":"session-..."}
```

提交到`POST /api/sensor/heart-rate`即可走现有混合链路。`AppleWatchHeartRateAdapter`继承现有缓存/时间校验，只接受source=apple_watch，可作为未来原生bridge的独立缓冲组件；它自身不会连接设备。真实原生数据必须保留测量时间，不能用转发时间刷新TTL。断流回退规则与其他输入相同。

当前Resp仍模拟，所以即使原生桥接将来完成，data_source也只能为mixed；apple_watch标签只说明输入声明，当前入口不验证设备身份、真实性或医疗精度。默认simulated模式不会使用该组件。
