"""Minimal FastAPI app wired like backend/main.py's guard stack (no torch)."""

from fastapi import Depends, FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from api.dependencies import require_admin, require_native_access
from core.request_guard import RequestGuardMiddleware


def build_app() -> FastAPI:
    app = FastAPI()

    @app.get("/probe")
    def probe():
        return {"ok": True}

    @app.post("/admin/action", dependencies=[Depends(require_admin)])
    def admin_action():
        return {"ok": True}

    @app.post("/native/action", dependencies=[Depends(require_native_access)])
    def native_action():
        return {"ok": True}

    @app.post("/upload")
    async def upload(name: str = Form(...), f: UploadFile = File(...)):
        return {"name": name, "size": len(await f.read())}

    @app.post("/v1/audio/speech")
    def speech():
        return {"ok": True}

    app.add_middleware(RequestGuardMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3901", "app://sesly"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app
