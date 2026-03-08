from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from bson import ObjectId
from datetime import datetime
import re
import os
import json
from google import genai
from app.routes.auth_routes import verify_token
from app.database import users_collection, workspaces_collection, meetings_collection, boards_collection

router = APIRouter(tags=["meetings"])

# Configure Gemini
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


# ─── Helpers ──────────────────────────────
def require_admin(authorization: str):
    """Verify that the caller is an admin."""
    user = verify_token(authorization)
    db_user = users_collection.find_one({"email": user["email"]})
    if not db_user or not db_user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


class CreateMeeting(BaseModel):
    workspace_id: str
    title: str = "Daily Standup"


class MeetingNote(BaseModel):
    meeting_id: str
    text: str


# ─── Admin Endpoints ─────────────────────

@router.post("/admin/meetings/create")
def create_meeting(data: CreateMeeting, authorization: str = Header(None)):
    """Create a new standup meeting with a Jitsi link (admin only)."""
    user = require_admin(authorization)

    workspace = workspaces_collection.find_one({"_id": ObjectId(data.workspace_id)})
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Check if there's already an active meeting for this workspace
    existing = meetings_collection.find_one({
        "workspace_id": data.workspace_id,
        "status": "active",
    })
    if existing:
        raise HTTPException(
            status_code=400,
            detail="There's already an active meeting for this workspace",
        )

    # Generate unique Jitsi room name
    ws_name_clean = re.sub(r'[^a-zA-Z0-9]', '', workspace["name"])
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    room_name = f"SprintFlow-{ws_name_clean}-{timestamp}"
    jitsi_link = f"https://meet.jit.si/{room_name}"

    # Get workspace member emails for display
    member_emails = []
    for mid in workspace.get("members", []):
        u = users_collection.find_one({"_id": ObjectId(mid)}, {"email": 1})
        if u:
            member_emails.append(u["email"])

    meeting = {
        "workspace_id": data.workspace_id,
        "workspace_name": workspace["name"],
        "title": data.title,
        "room_name": room_name,
        "jitsi_link": jitsi_link,
        "created_by": user["email"],
        "invited_members": workspace.get("members", []),
        "notes": [],
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
    }

    result = meetings_collection.insert_one(meeting)

    return {
        "message": f"Meeting created for '{workspace['name']}'",
        "meeting_id": str(result.inserted_id),
        "jitsi_link": jitsi_link,
        "room_name": room_name,
        "title": data.title,
        "workspace_name": workspace["name"],
        "member_emails": member_emails,
    }


@router.post("/admin/meetings/{meeting_id}/end")
def end_meeting(meeting_id: str, authorization: str = Header(None)):
    """End an active meeting, generate AI summary, and auto-create tickets from notes."""
    require_admin(authorization)

    meeting = meetings_collection.find_one({"_id": ObjectId(meeting_id)})
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting["status"] != "active":
        raise HTTPException(status_code=400, detail="Meeting is not active")

    # Combine all notes and generate AI summary
    notes = meeting.get("notes", [])
    ai_summary = ""
    tickets_created = 0

    if notes:
        # Build transcript
        transcript_lines = []
        for note in notes:
            transcript_lines.append(f"[{note['user_email']}] ({note['timestamp']}): {note['text']}")
        full_transcript = "\n".join(transcript_lines)

        # ── 1. Generate AI summary ──
        summary_prompt = (
            "You are a standup meeting assistant. Summarize this meeting transcript.\n"
            "Highlight key updates, blockers, and decisions.\n\n"
            f"Transcript:\n{full_transcript}"
        )
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=summary_prompt,
            )
            ai_summary = response.text
        except Exception as e:
            print(f"[AI Summary Error] {type(e).__name__}: {e}")
            ai_summary = "AI summary could not be generated."

        # ── 2. Extract action items per user and auto-create tickets ──
        # Build a user_id -> email mapping from notes
        user_map = {}
        for note in notes:
            uid = note.get("user_id")
            if uid and uid not in user_map:
                user_map[uid] = note["user_email"]

        extraction_prompt = (
            "You are a project management assistant. Analyze these standup meeting notes "
            "and extract specific ACTION ITEMS (tasks that someone committed to doing).\n\n"
            "Rules:\n"
            "- Only extract tasks that a person said THEY WILL DO (commitments, not updates about past work)\n"
            "- Assign a priority: high, medium, or low\n"
            "- Ignore greetings, status updates about completed work, and general chat\n"
            "- If no action items exist for a user, omit them\n\n"
            f"Participant mapping (user_id -> email):\n"
        )
        for uid, email in user_map.items():
            extraction_prompt += f"  {uid} = {email}\n"

        extraction_prompt += (
            f"\nTranscript:\n{full_transcript}\n\n"
            "Return ONLY valid JSON (no markdown, no explanation) in this exact format:\n"
            '{"action_items": {"<user_id>": [{"task": "...", "priority": "high|medium|low"}]}}\n'
            "If there are no action items at all, return: {\"action_items\": {}}\n"
        )

        try:
            print(f"[Action Items] Extracting for {len(user_map)} users...")
            extraction_response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=extraction_prompt,
            )
            raw = extraction_response.text.strip()
            print(f"[Action Items] Raw AI response: {raw[:500]}")

            # Parse JSON — handle markdown code blocks
            if raw.startswith("```"):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)

            parsed = json.loads(raw)
            action_items = parsed.get("action_items", {})
            print(f"[Action Items] Found items for {len(action_items)} users")

            workspace_id = meeting["workspace_id"]

            for user_id, tasks in action_items.items():
                if not tasks or not isinstance(tasks, list):
                    continue

                print(f"[Action Items] Creating {len(tasks)} tickets for user {user_id}")

                # Load user's existing board
                board = boards_collection.find_one(
                    {"workspace_id": workspace_id, "user_id": user_id}
                )

                existing_tickets = board.get("tickets", []) if board else []
                existing_columns = board.get("columns", {}) if board else {}
                existing_order = board.get("execution_order", []) if board else []

                # Find next ticket ID
                max_id = max((t["id"] for t in existing_tickets), default=0)

                new_tickets = []
                new_columns = dict(existing_columns)

                for item in tasks:
                    if not isinstance(item, dict) or "task" not in item:
                        continue
                    max_id += 1
                    ticket = {
                        "id": max_id,
                        "task": item["task"],
                        "deadline": "",
                        "priority": item.get("priority", "medium"),
                        "dependency": 0,
                        "status": "pending",
                    }
                    new_tickets.append(ticket)
                    new_columns[str(max_id)] = "created"

                if new_tickets:
                    all_tickets = existing_tickets + new_tickets
                    boards_collection.update_one(
                        {"workspace_id": workspace_id, "user_id": user_id},
                        {"$set": {
                            "workspace_id": workspace_id,
                            "user_id": user_id,
                            "tickets": all_tickets,
                            "columns": new_columns,
                            "execution_order": existing_order,
                        }},
                        upsert=True,
                    )
                    tickets_created += len(new_tickets)
                    print(f"[Action Items] Saved {len(new_tickets)} tickets for user {user_id}")

        except json.JSONDecodeError as e:
            print(f"[Action Item Parse Error] {e}")
        except Exception as e:
            print(f"[Action Item Extraction Error] {type(e).__name__}: {e}")

    meetings_collection.update_one(
        {"_id": ObjectId(meeting_id)},
        {"$set": {
            "status": "ended",
            "ended_at": datetime.utcnow().isoformat(),
            "ai_summary": ai_summary,
        }}
    )

    return {
        "message": "Meeting ended",
        "ai_summary": ai_summary,
        "notes_count": len(notes),
        "tickets_created": tickets_created,
    }


@router.delete("/admin/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, authorization: str = Header(None)):
    """Delete a meeting from history (admin only)."""
    require_admin(authorization)

    result = meetings_collection.delete_one({"_id": ObjectId(meeting_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Meeting not found")

    return {"message": "Meeting deleted"}


@router.get("/admin/meetings")
def list_admin_meetings(authorization: str = Header(None)):
    """List all active meetings (admin only)."""
    require_admin(authorization)

    meetings = []
    for m in meetings_collection.find({"status": "active"}):
        meetings.append({
            "id": str(m["_id"]),
            "workspace_id": m["workspace_id"],
            "workspace_name": m["workspace_name"],
            "title": m["title"],
            "jitsi_link": m["jitsi_link"],
            "created_by": m["created_by"],
            "created_at": m["created_at"],
            "notes_count": len(m.get("notes", [])),
        })

    return {"meetings": meetings}


@router.get("/admin/meetings/history")
def meeting_history(authorization: str = Header(None)):
    """List ended meetings with transcripts and AI summaries (admin only)."""
    require_admin(authorization)

    meetings = []
    for m in meetings_collection.find({"status": "ended"}).sort("ended_at", -1).limit(20):
        # Build transcript from notes
        notes = m.get("notes", [])
        transcript_lines = []
        for note in notes:
            transcript_lines.append({
                "user": note["user_email"],
                "text": note["text"],
                "time": note["timestamp"],
            })

        meetings.append({
            "id": str(m["_id"]),
            "workspace_name": m["workspace_name"],
            "title": m["title"],
            "created_by": m["created_by"],
            "created_at": m["created_at"],
            "ended_at": m.get("ended_at", ""),
            "transcript": transcript_lines,
            "ai_summary": m.get("ai_summary", ""),
            "notes_count": len(notes),
        })

    return {"meetings": meetings}


# ─── User Endpoints ──────────────────────

@router.post("/meetings/notes")
def add_meeting_note(data: MeetingNote, authorization: str = Header(None)):
    """Add a transcription note to an active meeting."""
    user = verify_token(authorization)

    meeting = meetings_collection.find_one({"_id": ObjectId(data.meeting_id)})
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    if meeting["status"] != "active":
        raise HTTPException(status_code=400, detail="Meeting is not active")

    note = {
        "user_id": user["user_id"],
        "user_email": user["email"],
        "text": data.text.strip(),
        "timestamp": datetime.utcnow().strftime("%H:%M:%S"),
    }

    meetings_collection.update_one(
        {"_id": ObjectId(data.meeting_id)},
        {"$push": {"notes": note}}
    )

    return {"message": "Note added", "note": note}


@router.get("/meetings/active")
def get_active_meetings(authorization: str = Header(None)):
    """Get active meetings for workspaces the current user belongs to."""
    user = verify_token(authorization)
    user_id = user["user_id"]

    # Find workspaces user is a member of
    user_workspaces = []
    for w in workspaces_collection.find({"members": user_id}):
        user_workspaces.append(str(w["_id"]))

    if not user_workspaces:
        return {"meetings": []}

    # Find active meetings for those workspaces
    meetings = []
    for m in meetings_collection.find({
        "workspace_id": {"$in": user_workspaces},
        "status": "active",
    }):
        meetings.append({
            "id": str(m["_id"]),
            "workspace_id": m["workspace_id"],
            "workspace_name": m["workspace_name"],
            "title": m["title"],
            "jitsi_link": m["jitsi_link"],
            "created_by": m["created_by"],
            "created_at": m["created_at"],
        })

    return {"meetings": meetings}
