import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws/state")
async def state_stream(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            frame = websocket.app.state.demo.current_frame()
            await websocket.send_json(frame.model_dump())
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, OSError):
        # Sending detects disconnected clients on the next tick.
        return
