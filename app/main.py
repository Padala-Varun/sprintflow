from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.ticket_routes import router as ticket_router
from app.routes.status_routes import router as status_router
from app.routes.auth_routes import router as auth_router
from app.routes.ai_routes import router as ai_router
from app.routes.admin_routes import router as admin_router
from app.routes.workspace_routes import router as workspace_router
from app.routes.github_routes import router as github_router
from app.routes.meeting_routes import router as meeting_router

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(workspace_router)
app.include_router(ticket_router)
app.include_router(status_router)
app.include_router(ai_router)
app.include_router(github_router)
app.include_router(meeting_router)


@app.get("/")
def home():
    return {"message": "SprintFlow Backend Running"}