import os
import json
from datetime import datetime
from fastapi import APIRouter, Header, Query
from app.routes.auth_routes import verify_token
from app.database import boards_collection

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.5-flash")

router = APIRouter(prefix="/ai", tags=["ai"])


# ─── Daily Standup Summary ───────────────────────────────────────────────────

def local_standup(tickets, columns):
    """Local fallback: generate standup without LLM."""
    done = []
    in_progress = []
    blocked = []
    not_started = []

    for t in tickets:
        col = columns.get(str(t["id"]), columns.get(t["id"], "created"))
        if col == "completed":
            done.append(f"#{t['id']} {t.get('task', 'Untitled')}")
        elif col == "pending":
            in_progress.append(f"#{t['id']} {t.get('task', 'Untitled')}")
        elif col == "not_completed":
            blocked.append(f"#{t['id']} {t.get('task', 'Untitled')} — marked not completed")
        else:
            dep_id = t.get("dependency", 0)
            if dep_id and dep_id != 0:
                dep_col = columns.get(str(dep_id), columns.get(dep_id, "created"))
                if dep_col != "completed":
                    blocked.append(f"#{t['id']} {t.get('task', 'Untitled')} — waiting on #{dep_id}")
                    continue
            not_started.append(f"#{t['id']} {t.get('task', 'Untitled')}")

    lines = ["## 📋 Daily Standup Summary", ""]

    if done:
        lines += ["### ✅ Completed", ""]
        lines += [f"- {d}" for d in done]
        lines += [""]

    if in_progress:
        lines += ["### ⏳ In Progress", ""]
        lines += [f"- {d}" for d in in_progress]
        lines += [""]

    if blocked:
        lines += ["### 🚫 Blocked / Not Completed", ""]
        lines += [f"- {d}" for d in blocked]
        lines += [""]

    if not_started:
        lines += ["### 📋 Not Started", ""]
        lines += [f"- {d}" for d in not_started]
        lines += [""]

    total = len(tickets)
    done_count = len(done)
    progress = round((done_count / total) * 100) if total > 0 else 0
    lines += [f"**Progress:** {done_count}/{total} tasks completed ({progress}%)"]

    return "\n".join(lines)


@router.post("/standup")
def generate_standup(workspace_id: str = Query(...), authorization: str = Header(None)):
    user = verify_token(authorization)
    user_id = user["user_id"]

    board = boards_collection.find_one({"workspace_id": workspace_id, "user_id": user_id}, {"_id": 0})
    if not board or not board.get("tickets"):
        return {"summary": "No tickets on the board yet. Add some tickets first!", "source": "local"}

    tickets = board["tickets"]
    columns = board.get("columns", {})

    try:
        ticket_info = []
        for t in tickets:
            col = columns.get(str(t["id"]), columns.get(t["id"], "created"))
            ticket_info.append({
                "id": t["id"],
                "task": t.get("task", ""),
                "priority": t.get("priority", ""),
                "deadline": t.get("deadline", ""),
                "status": col,
                "depends_on": t.get("dependency", 0),
            })

        prompt = f"""You are a project manager generating a daily standup summary.

Today's date: {datetime.now().strftime('%Y-%m-%d')}

Board tickets:
{json.dumps(ticket_info, indent=2)}

Generate a concise, professional standup summary with these sections:
1. ✅ Completed - what's done
2. ⏳ In Progress - what's being worked on
3. 🚫 Blocked - what's stuck and why
4. 📋 To Do - what hasn't started yet
5. Overall progress percentage
6. Any concerns or recommendations

Format in markdown. Keep it concise and actionable. Use ticket numbers (#1, #2, etc).
Do NOT wrap in code fences. Just return the markdown directly."""

        response = model.generate_content(prompt)
        return {"summary": response.text, "source": "ai"}

    except (ResourceExhausted, Exception) as e:
        print(f"[AI Standup] Falling back to local: {e}")
        summary = local_standup(tickets, columns)
        return {"summary": summary, "source": "local"}


# ─── Deadline Risk Analysis ─────────────────────────────────────────────────

def local_risk_analysis(tickets, columns):
    """Local fallback: flag at-risk tasks based on deadline proximity."""
    today = datetime.now().date()
    risks = []

    for t in tickets:
        col = columns.get(str(t["id"]), columns.get(t["id"], "created"))
        if col == "completed":
            continue

        deadline_str = t.get("deadline", "")
        if not deadline_str:
            continue

        try:
            deadline = datetime.strptime(deadline_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        days_left = (deadline - today).days
        priority = (t.get("priority") or "").lower()

        risk = "low"
        reason = ""

        if days_left < 0:
            risk = "overdue"
            reason = f"Overdue by {abs(days_left)} day(s)"
        elif days_left == 0:
            risk = "critical"
            reason = "Due today!"
        elif days_left <= 2:
            risk = "high"
            reason = f"Only {days_left} day(s) left"
        elif days_left <= 5 and priority == "high":
            risk = "high"
            reason = f"{days_left} days left (high priority)"
        elif days_left <= 5:
            risk = "medium"
            reason = f"{days_left} days left"

        if risk != "low":
            dep_id = t.get("dependency", 0)
            is_blocked = False
            if dep_id and dep_id != 0:
                dep_col = columns.get(str(dep_id), columns.get(dep_id, "created"))
                if dep_col != "completed":
                    is_blocked = True
                    reason += f" + blocked by #{dep_id}"

            risks.append({
                "ticket_id": t["id"],
                "task": t.get("task", "Untitled"),
                "risk": risk,
                "reason": reason,
                "days_left": days_left,
                "deadline": deadline_str,
                "is_blocked": is_blocked,
            })

    risk_order = {"overdue": 0, "critical": 1, "high": 2, "medium": 3}
    risks.sort(key=lambda r: (risk_order.get(r["risk"], 99), r["days_left"]))

    return risks


@router.post("/risk-analysis")
def analyze_risks(workspace_id: str = Query(...), authorization: str = Header(None)):
    user = verify_token(authorization)
    user_id = user["user_id"]

    board = boards_collection.find_one({"workspace_id": workspace_id, "user_id": user_id}, {"_id": 0})
    if not board or not board.get("tickets"):
        return {"risks": [], "ai_summary": "", "source": "local"}

    tickets = board["tickets"]
    columns = board.get("columns", {})
    risks = local_risk_analysis(tickets, columns)

    ai_summary = ""
    source = "local"

    if risks:
        try:
            today_str = datetime.now().strftime('%Y-%m-%d')
            prompt = f"""You are a project risk analyst. Today is {today_str}.

These tasks have been flagged as at-risk:
{json.dumps(risks, indent=2)}

Give a brief, actionable risk assessment in markdown:
- Which tasks need immediate attention
- What actions to take to mitigate delays
- Any dependency chains that could cause cascading delays

Keep it to 3-5 bullet points maximum. Be direct and specific. Use ticket numbers.
Do NOT wrap in code fences."""

            response = model.generate_content(prompt)
            ai_summary = response.text
            source = "ai"

        except (ResourceExhausted, Exception) as e:
            print(f"[AI Risk] Falling back to local: {e}")
            if risks:
                lines = ["**⚠️ Risk Assessment:**", ""]
                for r in risks[:5]:
                    emoji = "🔴" if r["risk"] in ("overdue", "critical") else "🟡" if r["risk"] == "high" else "🟠"
                    lines.append(f"- {emoji} **#{r['ticket_id']}** {r['task']} — {r['reason']}")
                ai_summary = "\n".join(lines)
                source = "local"

    return {"risks": risks, "ai_summary": ai_summary, "source": source}
