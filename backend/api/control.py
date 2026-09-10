import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.control.models import control_schema

router = APIRouter()


@router.get("/api/schema/control")
async def schema():
    return control_schema()


@router.websocket("/ws/control")
async def control_stream(websocket: WebSocket, debug: bool = True):
    await websocket.accept()
    try:
        while True:
            # No await between capturing the session and reserving its sequence.
            packet = websocket.app.state.demo.current_control_frame(include_debug=debug)
            await websocket.send_json(packet.model_dump(exclude_none=True))
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, OSError):
        return
