import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.websocket import router
from backend.models import DemoRequest, DemoStatus, FeedbackRequest, Frame
from backend.session import DemoRuntime


def create_app(settings=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        yield
        app.state.demo.cancel_pending()

    app = FastAPI(title="Jianjing Backend MVP", version="1.2.0", lifespan=lifespan,
                  description="Simulated signals and prototype interaction indices; not medical diagnosis.")
    app.state.demo = DemoRuntime(settings)
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(CORSMiddleware, allow_origins=origins.split(","),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.include_router(router)

    @app.get("/health")
    async def health():
        return {"status": "ok", "data_source": "simulated"}

    @app.get("/api/controller")
    async def controller_status():
        return app.state.demo.controller_status()

    @app.get("/api/demo", response_model=DemoStatus)
    async def get_demo():
        return app.state.demo.status()

    @app.post("/api/demo", response_model=DemoStatus)
    async def set_demo(config: DemoRequest):
        return app.state.demo.reset(config)

    @app.post("/api/feedback", response_model=Frame)
    async def feedback(event: FeedbackRequest):
        return app.state.demo.report_discomfort()

    @app.get("/api/schema/state")
    async def state_schema():
        return Frame.model_json_schema()

    return app


app = create_app()
