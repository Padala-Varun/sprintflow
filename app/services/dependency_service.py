from app.services.ticket_service import load_tickets, save_tickets


def update_status(task_id, status):

    tickets = load_tickets()

    for t in tickets:
        if t["id"] == task_id:
            t["status"] = status

    save_tickets(tickets)

    return tickets


def find_blocked_tasks(task_id):

    tickets = load_tickets()

    blocked = []

    for t in tickets:
        if t["dependency"] == task_id:
            blocked.append(t["id"])

    return blocked


def check_dependency(task_id):
    """Check if a ticket's dependency is completed before allowing completion."""
    tickets = load_tickets()

    # Find the ticket
    ticket = None
    for t in tickets:
        if t["id"] == task_id:
            ticket = t
            break

    if ticket is None:
        return {"can_complete": False, "error": "Ticket not found"}

    dependency_id = ticket.get("dependency", 0)

    # No dependency — can complete freely
    if dependency_id == 0:
        return {"can_complete": True, "dependency_id": 0}

    # Find the dependency ticket
    dep_ticket = None
    for t in tickets:
        if t["id"] == dependency_id:
            dep_ticket = t
            break

    if dep_ticket is None:
        return {"can_complete": True, "dependency_id": dependency_id, "error": "Dependency ticket not found"}

    dep_status = dep_ticket.get("status", "pending")

    if dep_status == "completed":
        return {
            "can_complete": True,
            "dependency_id": dependency_id,
            "dependency_status": dep_status,
            "dependency_task": dep_ticket.get("task", ""),
        }
    else:
        return {
            "can_complete": False,
            "dependency_id": dependency_id,
            "dependency_status": dep_status,
            "dependency_task": dep_ticket.get("task", ""),
        }