from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from bson import ObjectId
from app.routes.auth_routes import verify_token
from app.database import users_collection, workspaces_collection, invitations_collection, boards_collection

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(authorization: str):
    """Verify that the caller is an admin."""
    user = verify_token(authorization)
    db_user = users_collection.find_one({"email": user["email"]})
    if not db_user or not db_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class CreateWorkspace(BaseModel):
    name: str


class InviteUser(BaseModel):
    workspace_id: str
    user_email: str


class RemoveMember(BaseModel):
    workspace_id: str
    user_id: str


@router.get("/users")
def list_users(authorization: str = Header(None)):
    """List all registered users (admin only)."""
    require_admin(authorization)

    users = []
    for u in users_collection.find({}, {"password": 0}):
        users.append({
            "id": str(u["_id"]),
            "email": u["email"],
            "is_admin": u.get("is_admin", False),
        })
    return {"users": users}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, authorization: str = Header(None)):
    """Delete a registered user (admin only). Cannot delete admin accounts."""
    require_admin(authorization)

    target = users_collection.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.get("is_admin"):
        raise HTTPException(status_code=400, detail="Cannot delete admin accounts")

    email = target["email"]

    # Remove user from all workspaces
    workspaces_collection.update_many(
        {"members": user_id},
        {"$pull": {"members": user_id}}
    )

    # Delete pending invitations
    invitations_collection.delete_many({"to_user_id": user_id})

    # Delete user's boards
    boards_collection.delete_many({"user_id": user_id})

    # Delete the user
    users_collection.delete_one({"_id": ObjectId(user_id)})

    return {"message": f"User '{email}' deleted"}


@router.post("/workspaces")
def create_workspace(data: CreateWorkspace, authorization: str = Header(None)):
    """Create a new workspace (admin only)."""
    user = require_admin(authorization)

    if workspaces_collection.find_one({"name": data.name}):
        raise HTTPException(status_code=400, detail="Workspace name already exists")

    result = workspaces_collection.insert_one({
        "name": data.name,
        "created_by": user["user_id"],
        "members": [user["user_id"]],
    })

    return {
        "message": f"Workspace '{data.name}' created",
        "workspace_id": str(result.inserted_id),
    }


@router.get("/workspaces")
def list_all_workspaces(authorization: str = Header(None)):
    """List all workspaces with member details (admin only)."""
    require_admin(authorization)

    # Build a user_id -> email lookup
    all_users = {}
    for u in users_collection.find({}, {"password": 0}):
        all_users[str(u["_id"])] = u["email"]

    workspaces = []
    for w in workspaces_collection.find():
        members_detail = []
        for mid in w.get("members", []):
            members_detail.append({
                "id": mid,
                "email": all_users.get(mid, "unknown"),
            })
        workspaces.append({
            "id": str(w["_id"]),
            "name": w["name"],
            "member_count": len(members_detail),
            "members": members_detail,
        })
    return {"workspaces": workspaces}


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: str, authorization: str = Header(None)):
    """Delete a workspace, its board data, and pending invites (admin only)."""
    require_admin(authorization)

    workspace = workspaces_collection.find_one({"_id": ObjectId(workspace_id)})
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    ws_name = workspace["name"]
    workspaces_collection.delete_one({"_id": ObjectId(workspace_id)})
    boards_collection.delete_one({"workspace_id": workspace_id})
    invitations_collection.delete_many({"workspace_id": workspace_id})

    return {"message": f"Workspace '{ws_name}' deleted"}


@router.post("/invite")
def invite_user(data: InviteUser, authorization: str = Header(None)):
    """Invite a user to a workspace (admin only)."""
    require_admin(authorization)

    workspace = workspaces_collection.find_one({"_id": ObjectId(data.workspace_id)})
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    target_user = users_collection.find_one({"email": data.user_email})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    target_user_id = str(target_user["_id"])

    if target_user_id in workspace.get("members", []):
        raise HTTPException(status_code=400, detail="User is already a member")

    existing = invitations_collection.find_one({
        "workspace_id": data.workspace_id,
        "to_user_id": target_user_id,
        "status": "pending",
    })
    if existing:
        raise HTTPException(status_code=400, detail="Invite already pending")

    invitations_collection.insert_one({
        "workspace_id": data.workspace_id,
        "workspace_name": workspace["name"],
        "to_user_id": target_user_id,
        "to_email": data.user_email,
        "status": "pending",
    })

    return {"message": f"Invited {data.user_email} to '{workspace['name']}'"}


@router.post("/remove-member")
def remove_member(data: RemoveMember, authorization: str = Header(None)):
    """Remove a user from a workspace (admin only)."""
    require_admin(authorization)

    workspace = workspaces_collection.find_one({"_id": ObjectId(data.workspace_id)})
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    if data.user_id not in workspace.get("members", []):
        raise HTTPException(status_code=400, detail="User is not a member")

    workspaces_collection.update_one(
        {"_id": ObjectId(data.workspace_id)},
        {"$pull": {"members": data.user_id}}
    )

    # Find the user's email for the message
    user = users_collection.find_one({"_id": ObjectId(data.user_id)})
    email = user["email"] if user else "unknown"

    return {"message": f"Removed {email} from '{workspace['name']}'"}
