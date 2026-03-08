from fastapi import APIRouter, Header, Query
from app.schemas import StatusUpdate
from app.routes.auth_routes import verify_token
from app.database import boards_collection

router = APIRouter()


@router.post("/status")
def update_task_status(data: StatusUpdate, workspace_id: str = Query(...), authorization: str = Header(None)):
    user = verify_token(authorization)
    user_id = user["user_id"]

    # Update the column for this ticket in MongoDB (user's own board)
    boards_collection.update_one(
        {"workspace_id": workspace_id, "user_id": user_id},
        {"$set": {f"columns.{data.task_id}": data.status}}
    )

    # Also update the ticket status in the tickets array
    board = boards_collection.find_one({"workspace_id": workspace_id, "user_id": user_id})
    if board:
        tickets = board.get("tickets", [])
        for t in tickets:
            if t["id"] == data.task_id:
                t["status"] = data.status
        boards_collection.update_one(
            {"workspace_id": workspace_id, "user_id": user_id},
            {"$set": {"tickets": tickets}}
        )

    return {"message": f"Task {data.task_id} updated to {data.status}"}