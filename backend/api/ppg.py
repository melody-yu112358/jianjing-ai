from pathlib import Path

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from backend.api.sensor import SensorRoute
from fastapi import APIRouter
from backend.sensors.external import HeartRateInput, InputRejected
from backend.sensors.ppg import PPGRequest, estimate_ppg

router = APIRouter(route_class=SensorRoute)
DEMO = Path(__file__).resolve().parents[2] / "tools" / "ppg-demo"


@router.get("/tools/ppg-demo/", include_in_schema=False)
async def demo():
    return FileResponse(DEMO / "index.html")


@router.get("/tools/ppg-demo/app.js", include_in_schema=False)
async def demo_script():
    return FileResponse(DEMO / "app.js", media_type="text/javascript")


@router.post("/api/sensor/ppg")
async def ppg(value: PPGRequest, request: Request):
    runtime = request.app.state.demo
    session = runtime.session
    if value.session_id != session.control.session_id:
        raise HTTPException(409, "session_mismatch")
    duration = value.samples[-1].t-value.samples[0].t
    if value.timestamp-duration < session.external_hr.created_at:
        raise HTTPException(409, "measurement_started_before_reset")
    now = runtime.clock()
    if value.timestamp > now + 2 or now-value.timestamp > runtime.sensor_settings.ttl_sec:
        raise HTTPException(422, "measurement_timestamp_invalid")
    result = await run_in_threadpool(estimate_ppg, value.samples, torch_enabled=value.torch_enabled)
    # Reset while processing must never populate the replacement session.
    if runtime.session is not session:
        raise HTTPException(409, "session_changed_during_measurement")
    if result.valid:
        try:
            runtime.accept_heart_rate(HeartRateInput(timestamp=value.timestamp, heart_rate=result.heart_rate,
                source="phone_ppg", session_id=value.session_id, signal_quality=result.signal_quality,
                duration_sec=result.duration_sec, measurement_phase=value.phase))
        except InputRejected as error:
            raise HTTPException(error.status_code, error.reason) from error
    session.last_ppg_result = result.model_dump()
    return {**result.model_dump(), "accepted": result.valid, "sensor_status": runtime.sensor_status()}
