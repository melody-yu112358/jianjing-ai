# 手机 PPG 短测：实现与验收

## 本次交付与未完成项

已实现独立工具`tools/ppg-demo/`、Python心率估算、工程质量门控、现有HR缓冲接入、前后测记录。无正式前端修改，无新依赖。**未完成物理手机实测**，尚不能给出具体机型支持清单或测量误差。自动化波形和网络联调不能替代设备验收。

PPG利用光学强度随脉搏产生的变化估算心率；已有研究验证过特定手机算法，但不代表本仓库这个新实现已获得相同准确度。[原始验证研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC5368348/)。本实现不测HRV、心电、真实呼吸，也不判断疾病、睡眠阶段或脑区活动。

## 启动和访问

```powershell
$env:SENSOR_MODE = 'mixed'
$env:CONTROLLER_MODE = 'rule'
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

本机打开`http://127.0.0.1:8000/tools/ppg-demo/`可检查页面；电脑摄像头不等同于手机后置摄像头+闪光灯。手机访问需要**可信HTTPS**，普通`http://电脑局域网IP`不满足getUserMedia安全上下文要求。[MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。不要靠忽略证书警告或关闭浏览器安全限制解决。

团队已有可信HTTPS代理时，将页面与`/api/`转发到同一后端即可，无跨域配置和API Key。也可使用团队提供、手机已信任且包含对应主机名/IP的证书：

```powershell
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8443 --ssl-certfile /path/to/cert.pem --ssl-keyfile /path/to/key.pem
```

仅在可信测试网络使用，当前服务没有认证。无需、也不要把模型Key放入页面。没有可用可信证书/网络时可先运行自动测试，本仓库未配置公网代理、安装证书或修改防火墙。

## 20–30秒前后测流程

1. 确认后端mixed模式。点击“新会话 / 清空记录”，暂不连接正式视觉页面，以免前测期间就推进仪式时钟。
2. 点击“开始前测”，主动授予摄像头权限。工具要求后置摄像头及可用torch能力；无法启用则停止，不生成替代HR。
3. 手指轻盖镜头与闪光灯，不要用力压。曝光预热约1.5秒，随后采集约25秒；保持页面前台。发热或不适立即停止。
4. 工具关闭摄像头和闪光灯，提交颜色均值。质量通过才写入HR缓冲和pre记录；失败显示原因，重新测量，不填写猜测读数。
5. 前测成功后连接正式前端`/ws/control`并开始仪式。结束前预留约25秒进行后测；前后测使用同一session_id，不要中途reset。
6. 刷新记录或GET `/api/session/summary`查看两次BPM、采集时间、质量与差值。差值只表示本次两次测量的变化，不代表疗效、放松成功或已入睡。

**短测不是连续监测。** 默认5秒TTL不延长：每次短测结果仅在窗口结束后的TTL内作为HR输入，测量间隔回退模拟HR，Resp一直模拟。baseline仍按原规则建立，因此可包含不同来源；本阶段不建立持续真实生理闭环。前端应根据当前data_source展示来源，summary中的历史测量不等于当前实时值。

## 算法与质量

摄像头每个新帧在中心50%区域取ROI，缩为32×32并计算RGB均值。使用实际视频帧时间戳，重复帧不重复计数；支持requestVideoFrameCallback，旧浏览器回退到去重的video.currentTime。该接口的语义见[MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)。图像不离开浏览器，后端只接收最多1200个RGB均值样本。

`backend/sensors/ppg.py`流程：时序/曝光/覆盖检查 → 按真实时刻插值到30Hz → 线性去趋势与3点平滑 → Hann窗DFT主频搜索 → 半窗一致性及周期相关性 → BPM与signal_quality。

当前工程门控：

| 检查 | 当前规则 |
|---|---|
| 时长与帧率 | 20–30.5秒，至少300样本，实际平均15–65fps |
| 中断/不稳定 | 时间严格递增，最大间隔0.25秒；间隔变异系数≤0.35 |
| 覆盖与曝光 | ≥85%帧具有足够红色优势；饱和或黑场比例≤5% |
| 波动 | 去趋势幅度≥0.15灰度单位，拒绝过大幅度/突变 |
| 主频与分段 | 搜索0.4–4.1Hz，接受估算45–180BPM；前后半窗差≤8BPM |
| 质量 | 谱一致度≥0.45，半窗一致度≥0.4，组合质量≥0.65 |

quality约为0.5×谱一致度+0.3×周期相关性+0.2×分段一致性。这些阈值是**未经过设备人体验证的保守原型参数**，不是医学界值或概率；强周期性灯光/运动仍可能产生误判。频率搜索步长0.02Hz，BPM标称网格约1.2；输出小数不代表相应测量精度。红通道过曝会拒绝，某些手机即使有摄像头也无法稳定通过；不保证所有手机支持。

有效结果：

```json
{"valid":true,"heart_rate":82.8,"signal_quality":0.84,"duration_sec":25,"source":"phone_ppg","failure_reason":null}
```

无效结果heart_rate为null、valid=false、accepted=false，failure_reason可为torch_unavailable、finger_not_covered、exposure_clipped、signal_too_weak、frame_interruption、unstable_frame_rate、motion_or_pressure_change、inconsistent_pulse、low_signal_quality、bpm_out_of_range等。无效测量不覆盖仍在TTL内的旧有效值；旧值仍按原规则过期。

## API与记录

独立页面使用`POST /api/sensor/ppg`：

```json
{
  "timestamp":1789016400.125,
  "session_id":"session-...",
  "phase":"pre",
  "torch_enabled":true,
  "samples":[{"t":0,"r":180,"g":70,"b":50},{"t":0.0333,"r":180.5,"g":70,"b":50}]
}
```

示例省略了其余25秒样本，不能直接作为有效测量提交。timestamp是测量窗结束的UTC秒，而非新伪造的采样时间。页面用status.server_timestamp粗略校对客户端时钟；网络过慢导致过期会拒绝，不能靠重写时间戳重放旧测量。

后端在工作线程中估算，避免阻塞1Hz推送；有效结果走与`POST /api/sensor/heart-rate`相同的`accept_heart_rate`及ExternalHeartRateAdapter。若计算期间reset，结果以409拒绝。均值序列不保存到Session或数据库；summary仅保留两次结果与最近一次质量结果。

已有HR入口兼容原来的两个必填字段，独立估算组件也可提交：

```json
{"timestamp":1789016400.125,"heart_rate":82,"source":"phone_ppg","valid":true,"signal_quality":0.84,"duration_sec":25,"measurement_phase":"pre","session_id":"session-..."}
```

phone_ppg必须携带质量、时长、phase和session_id；不足阈值不接受。但该入口无法凭声明证明客户端真的采集过摄像头，也无法验证第三方算法质量，推荐使用服务端估算入口。当前无设备认证，source只是来源声明。

`field_sources.heart_rate`与status中的source为phone_ppg；Resp为simulated，所以v2.data_source仍为mixed。过期后当前source/data_source回到simulated，历史pre/post记录保留至reset。所有WebSocket schema、guidance、seq和Visual Mapper不改。

`GET /api/session/summary`新增pre_ritual_hr、post_ritual_hr、完整pre_measurement/post_measurement、delta_bpm、当前来源、controller_mode、data_source、last_ppg_result及中性message。后测要求先有前测；完成后测后需要新会话才能重做前测。phase是操作员声明的前/后测，不表示后端证明了实际干预起止时刻。

## 设备验收清单（待执行）

- 记录手机型号、系统/浏览器版本、后置摄像头选择、torch是否成功、实际fps与失败原因。
- 前测/后测各25秒，核对status中phone_ppg→mixed及TTL回退；重测失败不能写入HR。
- 核对中途取消、拒绝授权、切后台、网络失败、手机发热后的资源释放。
- 若有独立可靠参照设备，记录同一时间窗对比，但不将单次一致称为临床验证。
- 把结果追加到docs/VALIDATION.md；在此之前不得宣称物理手机链路已跑通。

## 自动测试

```bash
python -m pytest -q
node --test tools/ppg-demo/test_capture.cjs
python scripts/test_ppg_ws.py
```

Python测试验证波形和后端；Node测试使用模拟DOM/摄像头验证采集及取消，不访问物理设备。网络脚本在真实时间等待两个测量窗，发送合成PPG并校验HTTP、State Engine及双WebSocket，约一分钟；这仍不是手机实测。
