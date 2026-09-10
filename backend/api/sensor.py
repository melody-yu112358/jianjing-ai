from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from backend.sensors.external import HeartRateInput, InputRejected

class SensorRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def validate_request(request):
            try:
                return await handler(request)
            except RequestValidationError as error:
                # Do not echo invalid NaN/Infinity into JSON errors (which causes 500).
                detail = [{key: item[key] for key in ("type", "loc", "msg")} for item in error.errors()]
                raise HTTPException(status_code=422, detail=detail) from error
        return validate_request


router = APIRouter(route_class=SensorRoute)


@router.post("/api/sensor/heart-rate")
async def heart_rate(value: HeartRateInput, request: Request):
    runtime = request.app.state.demo
    try:
        runtime.session.external_hr.accept(value)
    except InputRejected as error:
        raise HTTPException(status_code=error.status_code, detail=error.reason) from error
    return {"accepted": True, **runtime.sensor_status()}


@router.get("/api/sensor/status")
async def sensor_status(request: Request):
    return request.app.state.demo.sensor_status()
