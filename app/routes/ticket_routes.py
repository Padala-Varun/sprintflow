from fastapi import APIRouter, HTTPException, Header, Query
from google.api_core.exceptions import ResourceExhausted
from app.schemas import TicketRequest
from app.llm.priority_agent import prioritize_tasks
from app.routes.auth_routes import verify_token
from app.database import boards_collection
import re
import json

router = APIRouter()


@router.post("/tickets")
def create_tickets(data: TicketRequest, workspace_id: str = Query(...), authorization: str = Header(None)):
    user = verify_token(authorization)
    user_id = user["user_id"]

    try:
        tickets = [ticket.dict() for ticket in data.tickets]

        order = prioritize_tasks(tickets)

        try:
            parsed_order = json.loads(order)
        except:
            match = re.search(r'\{.*\}', order, re.DOTALL)
            if match:
                parsed_order = json.loads(match.group())
            else:
                parsed_order = {"execution_order": []}

        execution_order = parsed_order.get("execution_order", [])

        # Initialize all tickets in "created" column
        columns = {str(t["id"]): "created" for t in tickets}

        # Save to MongoDB under workspace + user
        boards_collection.update_one(
            {"workspace_id": workspace_id, "user_id": user_id},
            {"$set": {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "tickets": tickets,
                "columns": columns,
                "execution_order": execution_order,
            }},
            upsert=True
        )

        return {
            "message": "Tickets received",
            "execution_order": execution_order,
        }

    except ResourceExhausted:
        raise HTTPException(
            status_code=429,
            detail="AI quota exceeded. Please wait a moment and try again."
        )

    except Exception as e:
        print(f"[Unexpected Error] {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/board")
def get_board(workspace_id: str = Query(...), user_id: str = Query(None), authorization: str = Header(None)):
    """Load a board. If user_id is provided, load that user's board (read-only view)."""
    user = verify_token(authorization)
    target_user_id = user_id or user["user_id"]

    board = boards_collection.find_one(
        {"workspace_id": workspace_id, "user_id": target_user_id},
        {"_id": 0}
    )

    if not board:
        # Fallback: check for legacy board without user_id
        if not user_id:
            legacy = boards_collection.find_one(
                {"workspace_id": workspace_id, "user_id": {"$exists": False}},
                {"_id": 0}
            )
            if legacy:
                # Migrate: assign this legacy board to the current user
                boards_collection.update_one(
                    {"workspace_id": workspace_id, "user_id": {"$exists": False}},
                    {"$set": {"user_id": user["user_id"]}}
                )
                return {
                    "tickets": legacy.get("tickets", []),
                    "columns": legacy.get("columns", {}),
                    "execution_order": legacy.get("execution_order", []),
                    "is_own_board": True,
                }
        return {"tickets": [], "columns": {}, "execution_order": [], "is_own_board": target_user_id == user["user_id"]}

    return {
        "tickets": board.get("tickets", []),
        "columns": board.get("columns", {}),
        "execution_order": board.get("execution_order", []),
        "is_own_board": target_user_id == user["user_id"],
    }


@router.delete("/board")
def clear_board(workspace_id: str = Query(...), authorization: str = Header(None)):
    """Clear the current user's board data for the workspace."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    boards_collection.delete_one({"workspace_id": workspace_id, "user_id": user_id})

    return {"message": "Board cleared"}