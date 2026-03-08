import json
from pathlib import Path

STORAGE_FILE = Path("storage/tickets.json")


def save_tickets(tickets):
    with open(STORAGE_FILE, "w") as f:
        json.dump(tickets, f)


def load_tickets():
    if not STORAGE_FILE.exists():
        return []

    with open(STORAGE_FILE) as f:
        return json.load(f)