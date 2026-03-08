from fastapi import APIRouter, HTTPException, Header
from bson import ObjectId
from app.routes.auth_routes import verify_token
from app.database import workspaces_collection, invitations_collection, users_collection

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/{workspace_id}/members")
def get_workspace_members(workspace_id: str, authorization: str = Header(None)):
    """Get all members of a workspace (available to any workspace member)."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    workspace = workspaces_collection.find_one({"_id": ObjectId(workspace_id)})
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Check caller is a member
    if user_id not in workspace.get("members", []):
        raise HTTPException(status_code=403, detail="Not a member of this workspace")

    # Build member list with emails
    members = []
    for mid in workspace.get("members", []):
        u = users_collection.find_one({"_id": ObjectId(mid)}, {"password": 0})
        if u:
            members.append({
                "id": mid,
                "email": u["email"],
                "is_current_user": mid == user_id,
            })

    return {"members": members, "workspace_name": workspace["name"]}


@router.get("/mine")
def my_workspaces(authorization: str = Header(None)):
    """List workspaces the current user belongs to."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    workspaces = []
    for w in workspaces_collection.find({"members": user_id}):
        workspaces.append({
            "id": str(w["_id"]),
            "name": w["name"],
            "member_count": len(w.get("members", [])),
        })
    return {"workspaces": workspaces}


@router.get("/invitations")
def get_invitations(authorization: str = Header(None)):
    """Get pending invitations for the current user."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    invites = []
    for inv in invitations_collection.find({"to_user_id": user_id, "status": "pending"}):
        invites.append({
            "id": str(inv["_id"]),
            "workspace_id": inv["workspace_id"],
            "workspace_name": inv["workspace_name"],
        })
    return {"invitations": invites}


@router.post("/invitations/{invite_id}/accept")
def accept_invitation(invite_id: str, authorization: str = Header(None)):
    """Accept an invitation to join a workspace."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    invite = invitations_collection.find_one({
        "_id": ObjectId(invite_id),
        "to_user_id": user_id,
        "status": "pending",
    })
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Update invitation status
    invitations_collection.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "accepted"}}
    )

    # Add user to workspace members
    workspaces_collection.update_one(
        {"_id": ObjectId(invite["workspace_id"])},
        {"$addToSet": {"members": user_id}}
    )

    return {"message": f"Joined workspace '{invite['workspace_name']}'"}


@router.post("/invitations/{invite_id}/reject")
def reject_invitation(invite_id: str, authorization: str = Header(None)):
    """Reject an invitation."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    invite = invitations_collection.find_one({
        "_id": ObjectId(invite_id),
        "to_user_id": user_id,
        "status": "pending",
    })
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")

    invitations_collection.update_one(
        {"_id": ObjectId(invite_id)},
        {"$set": {"status": "rejected"}}
    )

    return {"message": "Invitation rejected"}
