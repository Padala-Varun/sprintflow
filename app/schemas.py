from pydantic import BaseModel
from typing import List

class Ticket(BaseModel):
    id: int
    task: str
    deadline: str
    priority: str
    dependency: int
    status: str = "pending"


class TicketRequest(BaseModel):
    tickets: List[Ticket]


class StatusUpdate(BaseModel):
    task_id: int
    status: str