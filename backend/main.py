import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.websocket import router
from backend.models import DemoRequest, DemoStatus, Frame
from backend.session import DemoRuntime


def create_app() -> FastAPI:
    app = FastAPI(title="Jianjing Backend MVP", version="1.0.0",
                  description="Simulated signals and prototype interaction indices; not medical diagnosis.")
    app.state.demo = DemoRuntime()
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(CORSMiddleware, allow_origins=origins.split(","),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.include_router(router)

    @app.get("/health")
    async def health():
        return {"status": "ok", "data_source": "simulated"}

    @app.get("/api/demo", response_model=DemoStatus)
    async def get_demo():
        return app.state.demo.status()

    @app.post("/api/demo", response_model=DemoStatus)
    async def set_demo(config: DemoRequest):
        return app.state.demo.reset(config)

    @app.get("/api/schema/state")
    async def state_schema():
        return Frame.model_json_schema()

    return app


app = create_app()
