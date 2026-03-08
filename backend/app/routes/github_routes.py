import os
import json
import httpx
from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel
from typing import Optional, List
from app.routes.auth_routes import verify_token
from app.database import users_collection, boards_collection

from google import genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

router = APIRouter(prefix="/github", tags=["github"])

GITHUB_API = "https://api.github.com"


# ─── Schemas ──────────────────────────────────────────────────────────────────

class GitHubConnectRequest(BaseModel):
    pat: str
    repo: str  # "owner/repo"


class GitHubAnalyzeRequest(BaseModel):
    repo: Optional[str] = None  # override saved repo


class GitHubApplyRequest(BaseModel):
    changes: List[dict]  # [{"ticket_id": 3, "new_status": "completed"}, ...]


# ─── Connect (save PAT + repo) ───────────────────────────────────────────────

@router.post("/connect")
def connect_github(data: GitHubConnectRequest, authorization: str = Header(None)):
    user = verify_token(authorization)

    # Validate the PAT by calling GitHub API
    try:
        resp = httpx.get(
            f"{GITHUB_API}/user",
            headers={"Authorization": f"token {data.pat}", "Accept": "application/vnd.github.v3+json"},
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Invalid GitHub token — could not authenticate")
        gh_user = resp.json()
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach GitHub API")

    # Save to user document
    users_collection.update_one(
        {"email": user["email"]},
        {"$set": {
            "github_pat": data.pat,
            "github_repo": data.repo,
            "github_username": gh_user.get("login", ""),
        }}
    )

    return {
        "message": f"Connected to GitHub as {gh_user.get('login', 'unknown')}",
        "github_username": gh_user.get("login", ""),
        "repo": data.repo,
    }


# ─── Status ───────────────────────────────────────────────────────────────────

@router.get("/status")
def github_status(authorization: str = Header(None)):
    user = verify_token(authorization)
    db_user = users_collection.find_one({"email": user["email"]})

    if not db_user or not db_user.get("github_pat"):
        return {"connected": False}

    return {
        "connected": True,
        "github_username": db_user.get("github_username", ""),
        "repo": db_user.get("github_repo", ""),
    }


# ─── Analyze Commits ─────────────────────────────────────────────────────────

@router.post("/analyze")
def analyze_commits(
    data: GitHubAnalyzeRequest,
    workspace_id: str = Query(...),
    authorization: str = Header(None),
):
    user = verify_token(authorization)
    db_user = users_collection.find_one({"email": user["email"]})

    if not db_user or not db_user.get("github_pat"):
        raise HTTPException(status_code=400, detail="GitHub not connected. Please connect first.")

    pat = db_user["github_pat"]
    repo = data.repo or db_user.get("github_repo", "")

    if not repo:
        raise HTTPException(status_code=400, detail="No repository specified")

    # Fetch recent commits from GitHub
    try:
        resp = httpx.get(
            f"{GITHUB_API}/repos/{repo}/commits",
            headers={"Authorization": f"token {pat}", "Accept": "application/vnd.github.v3+json"},
            params={"per_page": 20},
            timeout=15,
        )
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Repository '{repo}' not found")
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="GitHub token expired or revoked")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"GitHub API error: {resp.status_code}")

        commits_data = resp.json()
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="Could not reach GitHub API")

    # Extract commit info
    commits = []
    for c in commits_data[:20]:
        commits.append({
            "sha": c["sha"][:7],
            "message": c["commit"]["message"].split("\n")[0],  # first line only
            "author": c["commit"]["author"]["name"],
            "date": c["commit"]["author"]["date"][:10],
        })

    # Load workspace board for this user
    board = boards_collection.find_one({"workspace_id": workspace_id, "user_id": user["user_id"]}, {"_id": 0})
    if not board or not board.get("tickets"):
        return {
            "commits": commits,
            "matches": [],
            "ai_summary": "No tickets on the board to match against.",
        }

    tickets = board["tickets"]
    columns = board.get("columns", {})

    ticket_info = []
    for t in tickets:
        col = columns.get(str(t["id"]), columns.get(t["id"], "created"))
        ticket_info.append({
            "id": t["id"],
            "task": t.get("task", ""),
            "priority": t.get("priority", ""),
            "current_status": col,
        })

    # AI Analysis: match commits to tickets
    try:
        prompt = f"""You are an AI project analyst. Your job is to match Git commit messages to project tickets.

Here are the recent commits from the repository "{repo}":
{json.dumps(commits, indent=2)}

Here are the current tickets on the project board:
{json.dumps(ticket_info, indent=2)}

Analyze each commit message and determine if it corresponds to any ticket on the board.
A commit "corresponds" to a ticket if the commit message clearly relates to the ticket's task description.
For example:
- Commit "fix login page bug" matches ticket "Fix login page"
- Commit "add user authentication" matches ticket "Implement auth system"
- Commit "update README" likely does NOT match any specific ticket

For each match found, suggest the new status:
- If the commit message suggests the work is DONE (e.g. "fix", "complete", "implement", "add", "resolve"), suggest "completed"
- If the commit message suggests work IN PROGRESS (e.g. "wip", "start", "begin", "initial"), suggest "pending"

Return ONLY valid JSON in this exact format:
{{
  "matches": [
    {{
      "commit_sha": "abc1234",
      "commit_message": "fixed login bug",
      "ticket_id": 3,
      "ticket_task": "Fix login page",
      "suggested_status": "completed",
      "confidence": "high",
      "reason": "Commit directly addresses the login fix described in ticket #3"
    }}
  ],
  "summary": "Brief 1-2 sentence summary of the analysis"
}}

If no matches are found, return {{"matches": [], "summary": "No commits match current tickets."}}.
Only return JSON, no explanation outside the JSON."""

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        raw = response.text.strip()

        # Parse AI response
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            import re
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                parsed = json.loads(match.group())
            else:
                parsed = {"matches": [], "summary": "AI response could not be parsed."}

        return {
            "commits": commits,
            "matches": parsed.get("matches", []),
            "ai_summary": parsed.get("summary", ""),
        }

    except (ResourceExhausted, Exception) as e:
        print(f"[GitHub Analyze] AI failed: {e}")
        return {
            "commits": commits,
            "matches": [],
            "ai_summary": f"AI analysis unavailable: {str(e)[:100]}",
        }


# ─── Apply Changes ───────────────────────────────────────────────────────────

@router.post("/apply")
def apply_changes(
    data: GitHubApplyRequest,
    workspace_id: str = Query(...),
    authorization: str = Header(None),
):
    user = verify_token(authorization)

    board = boards_collection.find_one({"workspace_id": workspace_id, "user_id": user["user_id"]})
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    columns = board.get("columns", {})
    tickets = board.get("tickets", [])
    applied = []

    for change in data.changes:
        tid = change.get("ticket_id")
        new_status = change.get("new_status")

        if not tid or not new_status:
            continue

        # Update column
        columns[str(tid)] = new_status

        # Update ticket status in array
        for t in tickets:
            if t["id"] == tid:
                t["status"] = new_status

        applied.append({"ticket_id": tid, "new_status": new_status})

    boards_collection.update_one(
        {"workspace_id": workspace_id, "user_id": user["user_id"]},
        {"$set": {"columns": columns, "tickets": tickets}}
    )

    return {"message": f"Applied {len(applied)} change(s)", "applied": applied}


# ─── Disconnect ───────────────────────────────────────────────────────────────

@router.post("/disconnect")
def disconnect_github(authorization: str = Header(None)):
    user = verify_token(authorization)

    users_collection.update_one(
        {"email": user["email"]},
        {"$unset": {"github_pat": "", "github_repo": "", "github_username": ""}}
    )

    return {"message": "GitHub disconnected"}
