from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.admin import router as admin_router
from backend.app.api.annotations import router as annotations_router
from backend.app.api.artifacts import router as artifacts_router
from backend.app.api.insights import router as insights_router
from backend.app.api.jobs import router as jobs_router
from backend.app.api.library import router as library_router
from backend.app.api.memory import router as memory_router
from backend.app.api.pipeline import router as pipeline_router
from backend.app.api.revision import router as revision_router
from backend.app.api.source_proposals import router as source_proposals_router
from backend.app.api.test_support import router as test_support_router
from backend.app.api.workspace import router as workspace_router
from backend.app.core.config import get_settings
from backend.app.services.workspace import app_runtime_root, workspace_status


app = FastAPI(title="小说编辑器", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:15173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(annotations_router)
app.include_router(admin_router)
app.include_router(artifacts_router)
app.include_router(insights_router)
app.include_router(jobs_router)
app.include_router(library_router)
app.include_router(memory_router)
app.include_router(pipeline_router)
app.include_router(revision_router)
app.include_router(source_proposals_router)
if get_settings().enable_test_support:
    app.include_router(test_support_router)
app.include_router(workspace_router)


@app.get("/health")
def health() -> dict:
    settings = get_settings()
    workspace = workspace_status()
    return {
        "status": "ok",
        "service": "backend",
        "content_root": str(settings.content_root),
        "app_runtime_root": str(app_runtime_root()),
        "runtime_root": workspace.get("runtime_root"),
        "low_cost_mode": settings.low_cost_mode,
        "workspace": workspace,
    }
