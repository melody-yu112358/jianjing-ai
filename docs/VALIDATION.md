# Backend MVP 本地验证记录

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
