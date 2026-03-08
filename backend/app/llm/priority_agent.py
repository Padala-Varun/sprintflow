import os
import time
import json
from collections import defaultdict, deque
from dotenv import load_dotenv
import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)
model = genai.GenerativeModel("gemini-2.5-flash")


def local_prioritize(tickets):
    """
    Topological sort + priority/deadline ordering.
    Works entirely offline — no LLM needed.
    """
    priority_weight = {"high": 3, "medium": 2, "low": 1}

    # Build adjacency list and in-degree count
    graph = defaultdict(list)
    in_degree = defaultdict(int)
    ticket_map = {}

    for t in tickets:
        tid = t["id"]
        ticket_map[tid] = t
        in_degree.setdefault(tid, 0)
        dep = t.get("dependency", 0)
        if dep and dep != 0 and dep in [x["id"] for x in tickets]:
            graph[dep].append(tid)
            in_degree[tid] += 1

    # Kahn's algorithm with priority queue
    # Start with tickets that have no dependencies
    queue = []
    for tid in ticket_map:
        if in_degree[tid] == 0:
            t = ticket_map[tid]
            pw = priority_weight.get((t.get("priority") or "").lower(), 0)
            dl = t.get("deadline") or "9999-12-31"
            queue.append((-pw, dl, tid))  # negative pw for descending sort

    queue.sort()
    result = []

    while queue:
        _, _, tid = queue.pop(0)
        result.append(tid)

        for neighbor in graph[tid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                nt = ticket_map[neighbor]
                pw = priority_weight.get((nt.get("priority") or "").lower(), 0)
                dl = nt.get("deadline") or "9999-12-31"
                queue.append((-pw, dl, neighbor))
                queue.sort()

    # Add any remaining tickets (circular deps edge case)
    for tid in ticket_map:
        if tid not in result:
            result.append(tid)

    return result


def prioritize_tasks(tickets):
    """
    Try LLM first, fall back to local topological sort.
    """
    max_retries = 3

    for attempt in range(max_retries):
        try:
            prompt = f"""
You are an AI project manager.

Given the following tickets:

{tickets}

Determine the correct execution order based on:
- dependency
- deadline
- priority

Rules:
1. A task must run after its dependency
2. Earlier deadline first
3. Higher priority first

Return ONLY valid JSON like this:

{{"execution_order":[1,2,3]}}

Do not include explanation.
Only return JSON.
"""
            response = model.generate_content(prompt)
            return response.text

        except ResourceExhausted:
            wait_seconds = 30 * (attempt + 1)

            if attempt < max_retries - 1:
                print(f"[Quota Exceeded] Retrying in {wait_seconds}s... (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait_seconds)
            else:
                print("[Quota Exceeded] All retries failed. Using local topological sort fallback.")
                order = local_prioritize(tickets)
                return json.dumps({"execution_order": order})