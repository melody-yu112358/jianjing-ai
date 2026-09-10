# Device Acceptance / 现场设备验收

本工具是 prototype / non-medical measurement。**Physical phone still requires manual acceptance.**
Apple Watch remains adapter/docs only；没有 Watch App 或真实设备连接。
合成 PPG 和模拟摄像头测试只能验证代码，不得作为真实生理测量有效性证明。

## 服务预检

安装项目现有开发依赖，不需要新增依赖。PowerShell：

```powershell
$env:SENSOR_MODE='mixed'
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# 另开终端
python scripts/check_device_acceptance.py --base http://127.0.0.1:8000
```

脚本检查 /health、采集页面及脚本、sensor status 和连续三条 /ws/control v2 帧，显示来源和 TTL；失败返回非零。
它不重置会话、不注入 HR，但连接 WebSocket **会启动或推进共享仪式**，因此预检应在正式前测之前运行，之后新建会话。
若在真实短测后运行，TTL 可能在检查中到期，frame_sources 会如实记录 mixed → simulated。
HTTPS 使用系统信任的证书；脚本不跳过证书检查。手机 HTTPS 配置见 [PHONE_PPG.md](PHONE_PPG.md)。

## 物理手机手工流程

1. 记录手机型号、系统、浏览器版本、服务器版本/提交、测试人和日期；使用可信 HTTPS 打开 `/tools/ppg-demo/`。
2. 查看 secure_context 和 camera_api；摄像头和 torch 在授权前显示未检测，不视为通过。
3. 新建会话，确认 session_id 更新且旧 summary 清空。先不要连接正式视觉页面或其他 WebSocket 客户端。
4. 开始前测并授权。记录实际后置摄像头报告、torch capability、actual_sampling_fps、duration_sec。轻盖镜头，约 25 秒，发热或不适立即停止。
5. 仅 accepted 可作本次读数。记录 signal_quality、HR、session_id 和来源。质量是工程指标，不是医学置信度。失败不应显示伪造 BPM，也不应覆盖最近有效读数。
6. 点击“进入 / 重连仪式”。文字入口使用现有 v2 快照，不重置会话；正式视觉页面也可接入同一 session。HR 有效期内来源应为 phone_ppg，呼吸为 simulated，总来源 mixed。
7. 等待超过 ttl_sec：诊断 external expired=true，当前 HR 回退 simulated，总来源 simulated；历史前测仍保留，不作为实时读数。不要为了路演延长或伪装真实测量有效性。
8. 仪式结束前预留约 25 秒，或结束后完成后测；刷新会话记录核对同一 session 的 pre/post。只表达心率发生变化，不作疗效或入睡结论。
9. 新会话确认旧读数与 summary 清空；切回 SENSOR_MODE=simulated 并重启后端，确认无摄像头也可运行正式比赛 Demo。

## 故障验收矩阵

| 操作 | 预期 |
|---|---|
| 拒绝权限 | 显示权限提示，可重试，无新 HR |
| 不支持 torch | 显示换设备提示，释放摄像头，不伪造测量 |
| 离开页面/断开摄像头/手动停止 | 终止采集、关闭摄像头和灯，无未完成上传 |
| 移动、未覆盖镜头或弱信号 | rejected / 原因提示，不写入无效 HR |
| 测量期间其他客户端 reset | 提示会话不匹配，不复用旧测量 |
| 上传延迟超过 TTL | 提示过期或时间异常，检查记录后重测 |
| 断网、WebSocket 中断 | 显示连接异常；恢复后重连同一会话 |
| 有效 HR 到期 | 自动 simulated fallback，历史测量不冒充实时值 |

页面每秒读取服务端状态；断网时 status_connection 标为失败，此时之前显示的来源是最后一次观测，不代表当前状态。
本服务仍是单共享 session，无设备认证；现场应仅在受控网络使用。验收脚本只验证服务连通及协议，不验证摄像头、灯光、PPG 准确性或 HTTPS 在手机上的信任。

## 验收记录（必须由实际操作者填写）

- 日期 / 测试人 / commit：
- 手机 / OS / 浏览器 / URL：
- 前测 accepted、HR、quality、fps、duration、session_id：
- 后测 accepted、HR、quality、fps、duration：
- mixed 与 TTL 回退证据：
- 故障矩阵逐项结果：
- 原始测试环境问题与重测结论：
- 物理设备结论：未验收 / 通过本设备工程验收 / 失败（不等于医学验证）
