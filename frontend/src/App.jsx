import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// ─── Columns Definition ──────────────────────────────────────────────────────
const COLUMNS = [
  { id: "created", label: "Created", icon: "📋" },
  { id: "pending", label: "Pending", icon: "⏳" },
  { id: "completed", label: "Completed", icon: "✅" },
  { id: "not_completed", label: "Not Completed", icon: "❌" },
];

// ─── Toast Hook ───────────────────────────────────────────────────────────────
let toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((type, message) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, exit: true } : x)));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 300);
    }, 3500);
  }, []);
  return { toasts, add };
}

// ─── Auth Helper ─────────────────────────────────────────────────────────────
function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ─── Priority Badge ──────────────────────────────────────────────────────────
function PriorityBadge({ priority }) {
  const p = (priority || "").toLowerCase();
  if (!p) return null;
  let cls = "";
  if (p === "high") cls = "badge-high";
  else if (p === "medium") cls = "badge-medium";
  else if (p === "low") cls = "badge-low";
  else return null;
  return <span className={`kanban-card-badge ${cls}`}>{priority}</span>;
}

// ─── Kanban Card ─────────────────────────────────────────────────────────────
function KanbanCard({ ticket, onDragStart, draggingId, risk }) {
  return (
    <div
      className={`kanban-card ${draggingId === ticket.id ? "dragging" : ""} ${risk ? `risk-${risk.risk}` : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(ticket.id));
        e.dataTransfer.effectAllowed = "move";
        onDragStart(ticket.id);
      }}
    >
      <div className="kanban-card-id">
        <span>#{ticket.id}</span>
        {risk && (
          <span className={`risk-badge risk-badge-${risk.risk}`}>
            {risk.risk === "overdue" ? "🔴 OVERDUE" : risk.risk === "critical" ? "🔴 DUE TODAY" : risk.risk === "high" ? "🟡 HIGH RISK" : "🟠 AT RISK"}
          </span>
        )}
      </div>
      <div className="kanban-card-task">{ticket.task || "Untitled task"}</div>
      {risk && <div className="risk-reason">{risk.reason}</div>}
      <div className="kanban-card-meta">
        <PriorityBadge priority={ticket.priority} />
        {ticket.dependency > 0 && <span className="badge-dep">⤴ depends on #{ticket.dependency}</span>}
        {ticket.deadline && <span className="kanban-card-deadline">{ticket.deadline}</span>}
      </div>
    </div>
  );
}

// ─── Kanban Column ───────────────────────────────────────────────────────────
function KanbanColumn({ col, tickets, onDrop, onDragOver, onDragLeave, dragOverState, draggingId, onDragStart, riskMap }) {
  return (
    <div
      className={`kanban-column ${dragOverState === "allowed" ? "drag-over" : ""} ${dragOverState === "blocked" ? "drag-over-blocked" : ""}`}
      data-col={col.id}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(col.id); }}
      onDragLeave={() => onDragLeave(col.id)}
      onDrop={(e) => { e.preventDefault(); const ticketId = Number(e.dataTransfer.getData("text/plain")); onDrop(ticketId, col.id); }}
    >
      <div className="kanban-col-header">
        <span className="kanban-col-title">{col.icon} {col.label}</span>
        <span className="kanban-col-count">{tickets.length}</span>
      </div>
      <div className="kanban-col-body">
        {tickets.length === 0 ? (
          <div className="kanban-empty">Drop tickets here</div>
        ) : (
          tickets.map((t) => (
            <KanbanCard key={t.id} ticket={t} onDragStart={onDragStart} draggingId={draggingId} risk={riskMap[t.id]} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Login Page ──────────────────────────────────────────────────────────────
function LoginPage({ onLogin, toasts, addToast, theme, toggleTheme }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { addToast("error", "Please fill in all fields"); return; }
    setLoading(true);
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail || "Authentication failed"); return; }
      localStorage.setItem("token", data.token);
      localStorage.setItem("email", data.email);
      addToast("success", isRegister ? "Account created!" : "Welcome back!");
      onLogin(data.token, data.email);
    } catch { addToast("error", "Backend unreachable"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type} ${t.exit ? "exit" : ""}`}>
            <span className="icon">{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "⚠"}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
      <div className="login-page">
        <button className="btn btn-ghost btn-theme login-theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <div className="login-card">
          <div className="login-header">
            <h1>SprintFlow</h1>
            <p>{isRegister ? "Create your account" : "Sign in to your board"}</p>
          </div>
          <form onSubmit={handleSubmit}>
            <input className="input" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn btn-primary login-btn" type="submit" disabled={loading}>
              {loading ? <><span className="spinner" /> {isRegister ? "Creating…" : "Signing in…"}</> : isRegister ? "Create Account" : "Sign In →"}
            </button>
          </form>
          <div className="login-toggle">
            <span>{isRegister ? "Already have an account?" : "Don't have an account?"}</span>
            <button className="login-toggle-btn" onClick={() => setIsRegister(!isRegister)}>
              {isRegister ? "Sign in" : "Register"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Dependency Graph ────────────────────────────────────────────────────────
function DependencyGraph({ tickets, ticketColumns }) {
  const svgRef = useRef(null);
  const W = 700, H = 360, R = 30;

  const nodes = useMemo(() => {
    const count = tickets.length;
    return tickets.map((t, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      const cx = W / 2 + (count === 1 ? 0 : 220) * Math.cos(angle);
      const cy = H / 2 + (count === 1 ? 0 : 130) * Math.sin(angle);
      return { ...t, cx, cy };
    });
  }, [tickets]);

  const nodeMap = useMemo(() => {
    const m = {};
    nodes.forEach((n) => (m[n.id] = n));
    return m;
  }, [nodes]);

  const edges = useMemo(() => {
    return tickets.filter((t) => t.dependency && nodeMap[t.dependency]).map((t) => ({ from: nodeMap[t.dependency], to: nodeMap[t.id] }));
  }, [tickets, nodeMap]);

  const getNodeColor = (node) => {
    const col = ticketColumns[node.id];
    if (col === "completed") return "#059669";
    if (col === "not_completed") return "#dc2626";
    if (col === "pending") return "#6366f1";
    const lp = (node.priority || "").toLowerCase();
    if (lp === "high") return "#ef4444";
    if (lp === "medium") return "#f59e0b";
    if (lp === "low") return "#059669";
    return "#9ca3af";
  };

  return (
    <div className="glass-card" style={{ padding: "20px 16px" }}>
      <div className="section-label"><span className="accent-dot" />DEPENDENCY GRAPH</div>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#6366f1" /></marker>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="coloredBlur" /><feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {edges.map((e, i) => { const dx = e.to.cx - e.from.cx, dy = e.to.cy - e.from.cy, dist = Math.sqrt(dx * dx + dy * dy) || 1; const x1 = e.from.cx + (dx / dist) * R, y1 = e.from.cy + (dy / dist) * R, x2 = e.to.cx - (dx / dist) * (R + 8), y2 = e.to.cy - (dy / dist) * (R + 8); const mx = (x1 + x2) / 2 - dy * 0.25, my = (y1 + y2) / 2 + dx * 0.25; return (<g key={i}><path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke="#6366f120" strokeWidth={8} /><path d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeDasharray="6 4" markerEnd="url(#arrow)" style={{ filter: "url(#glow)" }}><animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" repeatCount="indefinite" /></path></g>); })}
        {nodes.map((n) => { const color = getNodeColor(n), col = ticketColumns[n.id]; return (<g key={n.id}><circle cx={n.cx} cy={n.cy} r={R + 7} fill="none" stroke={color} strokeWidth={1} opacity={0.15} /><circle cx={n.cx} cy={n.cy} r={R} fill="var(--bg-surface, #fff)" stroke={color} strokeWidth={2} style={{ filter: "url(#glow)" }} />{col === "completed" && <text x={n.cx + R - 4} y={n.cy - R + 8} textAnchor="middle" fill="#059669" fontSize={12} fontWeight="bold">✓</text>}{col === "not_completed" && <text x={n.cx + R - 4} y={n.cy - R + 8} textAnchor="middle" fill="#dc2626" fontSize={12} fontWeight="bold">✗</text>}<text x={n.cx} y={n.cy - 6} textAnchor="middle" fill={color} fontSize={12} fontFamily="'JetBrains Mono', monospace" fontWeight="700">#{n.id}</text><text x={n.cx} y={n.cy + 10} textAnchor="middle" fill="var(--text-muted, #6b7280)" fontSize={9} fontFamily="'JetBrains Mono', monospace">{(n.task || "untitled").length > 10 ? (n.task || "untitled").slice(0, 10) + "…" : n.task || "untitled"}</text></g>); })}
        {tickets.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" fill="var(--text-muted, #9ca3af)" fontSize={13}>No tickets yet</text>}
      </svg>
    </div>
  );
}

// ─── Admin Dashboard ─────────────────────────────────────────────────────────
function AdminDashboard({ token, addToast, onLogout, theme, toggleTheme }) {
  const [users, setUsers] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [newWsName, setNewWsName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteWsId, setInviteWsId] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedWs, setExpandedWs] = useState(null);
  const [searchUsers, setSearchUsers] = useState("");

  // Meeting state
  const [meetWsId, setMeetWsId] = useState("");
  const [meetTitle, setMeetTitle] = useState("Daily Standup");
  const [meetCreating, setMeetCreating] = useState(false);
  const [activeMeetings, setActiveMeetings] = useState([]);
  const [createdMeetLink, setCreatedMeetLink] = useState(null);
  const [meetingHistory, setMeetingHistory] = useState([]);
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [endingSummary, setEndingSummary] = useState(null);

  useEffect(() => {
    fetchUsers();
    fetchWorkspaces();
    fetchMeetings();
    fetchMeetingHistory();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API}/admin/users`, { headers: authHeaders(token) });
      const data = await res.json();
      setUsers(data.users || []);
    } catch { addToast("error", "Failed to load users"); }
  };

  const fetchWorkspaces = async () => {
    try {
      const res = await fetch(`${API}/admin/workspaces`, { headers: authHeaders(token) });
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
      if (data.workspaces?.length > 0 && !inviteWsId) setInviteWsId(data.workspaces[0].id);
    } catch { addToast("error", "Failed to load workspaces"); }
  };

  const createWorkspace = async () => {
    if (!newWsName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/workspaces`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ name: newWsName }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      setNewWsName("");
      fetchWorkspaces();
    } catch { addToast("error", "Failed to create workspace"); }
    finally { setLoading(false); }
  };

  const deleteWorkspace = async (wsId, wsName) => {
    if (!confirm(`Delete workspace "${wsName}"? This will remove all its data.`)) return;
    try {
      const res = await fetch(`${API}/admin/workspaces/${wsId}`, {
        method: "DELETE", headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      setExpandedWs(null);
      fetchWorkspaces();
    } catch { addToast("error", "Failed to delete workspace"); }
  };

  const removeMember = async (wsId, userId) => {
    try {
      const res = await fetch(`${API}/admin/remove-member`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ workspace_id: wsId, user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      fetchWorkspaces();
    } catch { addToast("error", "Failed to remove member"); }
  };

  const inviteUser = async () => {
    if (!inviteEmail.trim() || !inviteWsId) return;
    try {
      const res = await fetch(`${API}/admin/invite`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ workspace_id: inviteWsId, user_email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      setInviteEmail("");
    } catch { addToast("error", "Failed to invite user"); }
  };

  // ─── Meeting Functions ─────────────────
  const fetchMeetings = async () => {
    try {
      const res = await fetch(`${API}/admin/meetings`, { headers: authHeaders(token) });
      const data = await res.json();
      setActiveMeetings(data.meetings || []);
    } catch { /* silent */ }
  };

  const createMeeting = async () => {
    if (!meetWsId) { addToast("error", "Select a workspace"); return; }
    setMeetCreating(true);
    try {
      const res = await fetch(`${API}/admin/meetings/create`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ workspace_id: meetWsId, title: meetTitle }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      setCreatedMeetLink(data.jitsi_link);
      fetchMeetings();
    } catch { addToast("error", "Failed to create meeting"); }
    finally { setMeetCreating(false); }
  };

  const endMeeting = async (meetingId) => {
    try {
      const res = await fetch(`${API}/admin/meetings/${meetingId}/end`, {
        method: "POST", headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      if (data.tickets_created > 0) {
        addToast("success", `🎫 ${data.tickets_created} ticket${data.tickets_created > 1 ? "s" : ""} auto-created from meeting notes`);
      }
      setCreatedMeetLink(null);
      if (data.ai_summary) setEndingSummary(data.ai_summary);
      fetchMeetings();
      fetchMeetingHistory();
    } catch { addToast("error", "Failed to end meeting"); }
  };

  const fetchMeetingHistory = async () => {
    try {
      const res = await fetch(`${API}/admin/meetings/history`, { headers: authHeaders(token) });
      const data = await res.json();
      setMeetingHistory(data.meetings || []);
    } catch { /* silent */ }
  };

  const deleteMeeting = async (meetingId) => {
    if (!confirm("Delete this meeting from history?")) return;
    try {
      const res = await fetch(`${API}/admin/meetings/${meetingId}`, {
        method: "DELETE", headers: authHeaders(token),
      });
      if (res.ok) {
        addToast("success", "Meeting deleted");
        fetchMeetingHistory();
      } else {
        const data = await res.json();
        addToast("error", data.detail || "Failed to delete meeting");
      }
    } catch { addToast("error", "Failed to delete meeting"); }
  };

  const copyLink = (link) => {
    navigator.clipboard.writeText(link);
    addToast("success", "Meeting link copied!");
  };

  const deleteUser = async (userId, email) => {
    if (!confirm(`Delete user "${email}"? This will remove them from all workspaces.`)) return;
    try {
      const res = await fetch(`${API}/admin/users/${userId}`, {
        method: "DELETE", headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      fetchUsers();
      fetchWorkspaces();
    } catch { addToast("error", "Failed to delete user"); }
  };

  return (
    <div className="app">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>🛡️ Admin Dashboard</h1>
            <div className="subtitle">Manage workspaces and invite users</div>
          </div>
          <div className="user-bar">
            <button className="btn btn-ghost btn-theme" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
            <span className="user-email">admin</span>
            <button className="btn btn-ghost btn-logout" onClick={onLogout}>Logout ↗</button>
          </div>
        </div>
      </div>

      {/* Create Workspace */}
      <div className="glass-card">
        <div className="section-label"><span className="accent-dot" style={{ background: "#22c55e" }} />Create Workspace</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="input" placeholder="Workspace name (e.g. Project Alpha)" value={newWsName} onChange={(e) => setNewWsName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createWorkspace()} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={createWorkspace} disabled={loading}>
            {loading ? <><span className="spinner" /> Creating…</> : "+ Create"}
          </button>
        </div>
      </div>

      {/* Workspaces List */}
      <div className="glass-card">
        <div className="section-label"><span className="accent-dot" />Workspaces ({workspaces.length})</div>
        {workspaces.length === 0 ? (
          <div className="kanban-empty">No workspaces yet — create one above</div>
        ) : (
          <div className="ws-list">
            {workspaces.map((ws) => (
              <div key={ws.id} className={`ws-card-admin ${expandedWs === ws.id ? "expanded" : ""}`}>
                <div className="ws-card-admin-header" onClick={() => setExpandedWs(expandedWs === ws.id ? null : ws.id)}>
                  <div>
                    <div className="ws-card-name">{ws.name}</div>
                    <div className="ws-card-meta">{ws.member_count} member{ws.member_count !== 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button className="btn btn-ghost btn-delete-ws" onClick={(e) => { e.stopPropagation(); deleteWorkspace(ws.id, ws.name); }} title="Delete workspace">
                      🗑
                    </button>
                    <span className="ws-expand-icon">{expandedWs === ws.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedWs === ws.id && (
                  <div className="ws-members-list">
                    <div className="ws-members-header">Members</div>
                    {ws.members.map((m) => (
                      <div key={m.id} className="ws-member-row">
                        <span className="ws-member-email">{m.email}</span>
                        <button className="btn-member-remove" onClick={() => removeMember(ws.id, m.id)} title="Remove from workspace">✕ Remove</button>
                      </div>
                    ))}
                    {ws.members.length === 0 && <div className="notif-empty">No members</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite User */}
      <div className="glass-card">
        <div className="section-label"><span className="accent-dot" style={{ background: "#a78bfa" }} />Invite User to Workspace</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select className="input select-input" value={inviteWsId} onChange={(e) => setInviteWsId(e.target.value)}>
            <option value="">Select workspace</option>
            {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
          </select>
          <input className="input" placeholder="User email to invite" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={inviteUser}>📩 Invite</button>
        </div>
      </div>

      {/* Standup Meeting */}
      <div className="glass-card meeting-card">
        <div className="section-label"><span className="accent-dot" style={{ background: "#ef4444" }} />📹 Standup Video Call</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <select className="input select-input" value={meetWsId} onChange={(e) => setMeetWsId(e.target.value)}>
            <option value="">Select workspace</option>
            {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
          </select>
          <input className="input" placeholder="Meeting title" value={meetTitle} onChange={(e) => setMeetTitle(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-primary btn-create-meet" onClick={createMeeting} disabled={meetCreating}>
            {meetCreating ? <><span className="spinner" /> Creating…</> : "📹 Create Meet"}
          </button>
        </div>
        {createdMeetLink && (
          <div className="meeting-link-box">
            <span className="meeting-live-dot" />
            <span className="meeting-link-text">{createdMeetLink}</span>
            <button className="btn btn-ghost btn-copy-link" onClick={() => copyLink(createdMeetLink)}>📋 Copy</button>
            <a href={createdMeetLink} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-join-admin">🎥 Join</a>
          </div>
        )}
        {activeMeetings.length > 0 && (
          <div className="active-meetings-list">
            <div className="github-input-label" style={{ marginTop: 8, marginBottom: 6 }}>Active Meetings</div>
            {activeMeetings.map((m) => (
              <div key={m.id} className="active-meeting-row">
                <span className="meeting-live-dot" />
                <div style={{ flex: 1 }}>
                  <div className="active-meeting-title">{m.title}</div>
                  <div className="active-meeting-meta">{m.workspace_name} · by {m.created_by}</div>
                </div>
                <button className="btn btn-ghost btn-copy-link" onClick={() => copyLink(m.jitsi_link)}>📋</button>
                <a href={m.jitsi_link} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-join-admin">🎥</a>
                <button className="btn btn-ghost btn-end-meet" onClick={() => endMeeting(m.id)}>End</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Users List */}
      <div className="glass-card">
        <div className="section-label"><span className="accent-dot" style={{ background: "#f59e0b" }} />Registered Users ({users.length})</div>
        <input
          className="input"
          placeholder="🔍 Search users by email…"
          value={searchUsers}
          onChange={(e) => setSearchUsers(e.target.value)}
          style={{ marginBottom: 10 }}
        />
        <div className="users-list">
          {users.filter((u) => u.email.toLowerCase().includes(searchUsers.toLowerCase())).map((u) => (
            <div key={u.id} className="user-row">
              <span className="user-row-email">{u.email}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {u.is_admin && <span className="admin-badge">ADMIN</span>}
                {!u.is_admin && (
                  <button className="btn-member-remove" onClick={() => deleteUser(u.id, u.email)}>🗑 Delete</button>
                )}
              </div>
            </div>
          ))}
          {users.filter((u) => u.email.toLowerCase().includes(searchUsers.toLowerCase())).length === 0 && (
            <div className="notif-empty">No users match "{searchUsers}"</div>
          )}
        </div>
      </div>

      {/* Ending Summary Modal */}
      {endingSummary && (
        <div className="glass-card meeting-summary-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div className="section-label" style={{ margin: 0 }}><span className="accent-dot" style={{ background: "#a78bfa" }} />AI Meeting Summary</div>
            <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => setEndingSummary(null)}>✕</button>
          </div>
          <div className="meeting-summary-text" dangerouslySetInnerHTML={{ __html: endingSummary.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^- (.+)/gm, '<li>$1</li>').replace(/^### (.+)/gm, '<h4>$1</h4>').replace(/^## (.+)/gm, '<h3>$1</h3>') }} />
        </div>
      )}

      {/* Meeting History */}
      {meetingHistory.length > 0 && (
        <div className="glass-card">
          <div className="section-label"><span className="accent-dot" style={{ background: "#6366f1" }} />📝 Meeting History ({meetingHistory.length})</div>
          <div className="meeting-history-list">
            {meetingHistory.map((m) => (
              <div key={m.id} className={`meeting-history-card ${expandedHistory === m.id ? "expanded" : ""}`}>
                <div className="meeting-history-header" onClick={() => setExpandedHistory(expandedHistory === m.id ? null : m.id)}>
                  <div style={{ flex: 1 }}>
                    <div className="active-meeting-title">{m.title}</div>
                    <div className="active-meeting-meta">{m.workspace_name} · {m.notes_count} notes · {m.ended_at?.slice(0, 10)}</div>
                  </div>
                  <button className="btn btn-ghost btn-delete-ws" onClick={(e) => { e.stopPropagation(); deleteMeeting(m.id); }} title="Delete meeting">🗑</button>
                  <span className="ws-expand-icon">{expandedHistory === m.id ? "▲" : "▼"}</span>
                </div>
                {expandedHistory === m.id && (
                  <div className="meeting-history-body">
                    {m.ai_summary && (
                      <div className="history-section">
                        <div className="history-section-label">AI Summary</div>
                        <div className="meeting-summary-text" dangerouslySetInnerHTML={{ __html: m.ai_summary.replace(/\n/g, '<br/>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^- (.+)/gm, '<li>$1</li>') }} />
                      </div>
                    )}
                    {m.transcript.length > 0 && (
                      <div className="history-section">
                        <div className="history-section-label">Transcript</div>
                        <div className="transcript-list">
                          {m.transcript.map((n, i) => (
                            <div key={i} className="transcript-line">
                              <span className="transcript-user">{n.user.split("@")[0]}</span>
                              <span className="transcript-time">{n.time}</span>
                              <span className="transcript-text">{n.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {m.transcript.length === 0 && <div className="notif-empty">No transcription notes recorded</div>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workspace Selector ──────────────────────────────────────────────────────
function WorkspaceSelector({ token, addToast, onSelect, onLogout, theme, toggleTheme }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [showNotif, setShowNotif] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    try {
      const [wsRes, invRes] = await Promise.all([
        fetch(`${API}/workspaces/mine`, { headers: authHeaders(token) }),
        fetch(`${API}/workspaces/invitations`, { headers: authHeaders(token) }),
      ]);
      const wsData = await wsRes.json();
      const invData = await invRes.json();
      setWorkspaces(wsData.workspaces || []);
      setInvitations(invData.invitations || []);
    } catch { addToast("error", "Failed to load workspaces"); }
  };

  const handleInvite = async (inviteId, action) => {
    try {
      const res = await fetch(`${API}/workspaces/invitations/${inviteId}/${action}`, {
        method: "POST", headers: authHeaders(token),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      fetchAll();
    } catch { addToast("error", `Failed to ${action} invite`); }
  };

  return (
    <div className="app">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1>SprintFlow</h1>
            <div className="subtitle">Select a workspace to continue</div>
          </div>
          <div className="user-bar">
            <button className="btn btn-ghost btn-theme" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
            {/* Notification Bell */}
            <div className="notif-wrap">
              <button className="btn btn-ghost btn-notif" onClick={() => setShowNotif(!showNotif)}>
                🔔
                {invitations.length > 0 && <span className="notif-count">{invitations.length}</span>}
              </button>
              {showNotif && (
                <div className="notif-dropdown">
                  <div className="notif-header">Invitations</div>
                  {invitations.length === 0 ? (
                    <div className="notif-empty">No pending invitations</div>
                  ) : (
                    invitations.map((inv) => (
                      <div key={inv.id} className="notif-item">
                        <div className="notif-item-text">
                          Invited to <strong>{inv.workspace_name}</strong>
                        </div>
                        <div className="notif-actions">
                          <button className="btn-notif-accept" onClick={() => handleInvite(inv.id, "accept")}>✓ Accept</button>
                          <button className="btn-notif-reject" onClick={() => handleInvite(inv.id, "reject")}>✗</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <button className="btn btn-ghost btn-logout" onClick={onLogout}>Logout ↗</button>
          </div>
        </div>
      </div>

      {/* Workspace Grid */}
      <div className="glass-card">
        <div className="section-label"><span className="accent-dot" />My Workspaces ({workspaces.length})</div>
        {workspaces.length === 0 ? (
          <div className="kanban-empty" style={{ padding: 40 }}>
            No workspaces yet — wait for an admin to invite you!
          </div>
        ) : (
          <div className="ws-grid">
            {workspaces.map((ws) => (
              <div key={ws.id} className="ws-card ws-card-clickable" onClick={() => onSelect(ws)}>
                <div className="ws-card-name">{ws.name}</div>
                <div className="ws-card-meta">{ws.member_count} member{ws.member_count !== 1 ? "s" : ""}</div>
                <div className="ws-card-enter">Open →</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [userEmail, setUserEmail] = useState(localStorage.getItem("email") || "");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);

  useEffect(() => {
    document.body.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const [tickets, setTickets] = useState([{ id: 1, task: "", deadline: "", priority: "", dependency: 0 }]);
  const [executionOrder, setExecutionOrder] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [ticketColumns, setTicketColumns] = useState({});
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);
  const [dragBlocked, setDragBlocked] = useState(false);
  const [modal, setModal] = useState(null);
  const [clearLoading, setClearLoading] = useState(false);

  const [standupText, setStandupText] = useState(null);
  const [standupLoading, setStandupLoading] = useState(false);
  const [risks, setRisks] = useState([]);
  const [riskSummary, setRiskSummary] = useState("");
  const [riskLoading, setRiskLoading] = useState(false);

  // Notification state for board view
  const [invitations, setInvitations] = useState([]);
  const [showNotif, setShowNotif] = useState(false);

  // GitHub integration state
  const [showGithub, setShowGithub] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubAnalyzing, setGithubAnalyzing] = useState(false);
  const [githubAnalysis, setGithubAnalysis] = useState(null);
  const [githubApplying, setGithubApplying] = useState(false);

  // Team members state
  const [teamMembers, setTeamMembers] = useState([]);
  const [viewingMember, setViewingMember] = useState(null); // null = own board

  // Analytics state
  const [analytics, setAnalytics] = useState(null);

  // Active meetings state
  const [activeMeetings, setActiveMeetings] = useState([]);

  // Speech-to-text state
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [manualNote, setManualNote] = useState("");
  const recognitionRef = useRef(null);

  const speechSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const startRecording = (meetingId) => {
    if (!speechSupported) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      setLiveTranscript(interimText);
      if (finalText.trim()) {
        // Send final text to backend
        fetch(`${API}/meetings/notes`, {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({ meeting_id: meetingId, text: finalText.trim() }),
        }).catch(() => { });
        setLiveTranscript('');
      }
    };

    recognition.onerror = () => {
      setIsRecording(false);
    };

    recognition.onend = () => {
      // Restart if still recording (browser may stop after silence)
      if (recognitionRef.current && isRecording) {
        try { recognitionRef.current.start(); } catch { }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent restart
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    setLiveTranscript('');
  };

  const sendManualNote = (meetingId) => {
    if (!manualNote.trim()) return;
    fetch(`${API}/meetings/notes`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ meeting_id: meetingId, text: manualNote.trim() }),
    }).catch(() => { });
    setManualNote('');
  };

  const { toasts, add: addToast } = useToasts();

  // Fetch invitations count
  const fetchInvitations = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/workspaces/invitations`, { headers: authHeaders(token) });
      const data = await res.json();
      setInvitations(data.invitations || []);
    } catch { /* silent */ }
  }, [token]);

  // Check GitHub connection status
  const checkGithubStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/github/status`, { headers: authHeaders(token) });
      const data = await res.json();
      setGithubConnected(data.connected);
      if (data.connected) {
        setGithubUsername(data.github_username || "");
        setGithubRepo(data.repo || "");
      }
    } catch { /* silent */ }
  }, [token]);

  // Fetch team members
  const fetchTeamMembers = useCallback(async () => {
    if (!token || !selectedWorkspace) return;
    try {
      const res = await fetch(`${API}/workspaces/${selectedWorkspace.id}/members`, { headers: authHeaders(token) });
      const data = await res.json();
      setTeamMembers(data.members || []);
    } catch { /* silent */ }
  }, [token, selectedWorkspace]);

  // Fetch active meetings for this user
  const fetchActiveMeetings = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/meetings/active`, { headers: authHeaders(token) });
      const data = await res.json();
      setActiveMeetings(data.meetings || []);
    } catch { /* silent */ }
  }, [token]);

  // Load board (own or member's)
  const fetchAnalytics = useCallback(async () => {
    if (!token || !selectedWorkspace) return;
    try {
      const res = await fetch(`${API}/ai/analytics?workspace_id=${selectedWorkspace.id}`, { headers: authHeaders(token) });
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch { /* silent */ }
  }, [token, selectedWorkspace]);

  const loadBoard = useCallback(async (memberId) => {
    if (!token || !selectedWorkspace) return;
    try {
      const url = memberId
        ? `${API}/board?workspace_id=${selectedWorkspace.id}&user_id=${memberId}`
        : `${API}/board?workspace_id=${selectedWorkspace.id}`;
      const res = await fetch(url, { headers: authHeaders(token) });
      if (!res.ok) {
        if (res.status === 401) { handleLogout(); return; }
        return;
      }
      const data = await res.json();
      if (data.tickets && data.tickets.length > 0) {
        setTickets(data.tickets);
        const cols = {};
        for (const [k, v] of Object.entries(data.columns || {})) cols[Number(k)] = v;
        setTicketColumns(cols);
        setExecutionOrder(data.execution_order || []);
        setSubmitted(true);
      } else {
        setTickets([{ id: 1, task: "", deadline: "", priority: "", dependency: 0 }]);
        setExecutionOrder([]);
        setTicketColumns({});
        setSubmitted(false);
      }
    } catch { /* silent */ }
  }, [token, selectedWorkspace]);

  // Load board when workspace is selected
  useEffect(() => {
    if (!token || !selectedWorkspace) return;
    loadBoard();
    fetchAnalytics();
    fetchInvitations();
    checkGithubStatus();
    fetchTeamMembers();
    fetchActiveMeetings();
  }, [token, selectedWorkspace]);

  // Switch to a member's board
  const viewMemberBoard = (member) => {
    if (member.is_current_user) {
      setViewingMember(null);
      loadBoard();
    } else {
      setViewingMember(member);
      loadBoard(member.id);
    }
  };

  const backToMyBoard = () => {
    setViewingMember(null);
    loadBoard();
  };

  const isReadOnly = viewingMember !== null;

  const riskMap = useMemo(() => { const m = {}; risks.forEach((r) => (m[r.ticket_id] = r)); return m; }, [risks]);
  const ticketsByColumn = useMemo(() => {
    const groups = { created: [], pending: [], completed: [], not_completed: [] };
    tickets.forEach((t) => { const col = ticketColumns[t.id] || "created"; if (groups[col]) groups[col].push(t); });
    return groups;
  }, [tickets, ticketColumns]);

  const handleLogin = (newToken, email) => {
    setToken(newToken);
    setUserEmail(email);
    setIsAdmin(email === "admin123@gmail.com");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("email");
    setToken(null); setUserEmail(""); setIsAdmin(false); setSelectedWorkspace(null);
    setTickets([{ id: 1, task: "", deadline: "", priority: "", dependency: 0 }]);
    setExecutionOrder([]); setTicketColumns({}); setSubmitted(false);
    setStandupText(null); setRisks([]); setRiskSummary("");
  };

  // Detect admin on mount
  useEffect(() => {
    if (userEmail === "admin123@gmail.com") setIsAdmin(true);
  }, [userEmail]);

  // ─── Login ──────────────────────────────
  if (!token) return <LoginPage onLogin={handleLogin} toasts={toasts} addToast={addToast} theme={theme} toggleTheme={toggleTheme} />;

  // ─── Admin Dashboard ──────────────────
  if (isAdmin) return (
    <>
      <div className="toast-container">{toasts.map((t) => <div key={t.id} className={`toast ${t.type} ${t.exit ? "exit" : ""}`}><span className="icon">{t.type === "success" ? "✓" : "✗"}</span><span>{t.message}</span></div>)}</div>
      <AdminDashboard token={token} addToast={addToast} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
    </>
  );

  // ─── Workspace Selector ───────────────
  if (!selectedWorkspace) return (
    <>
      <div className="toast-container">{toasts.map((t) => <div key={t.id} className={`toast ${t.type} ${t.exit ? "exit" : ""}`}><span className="icon">{t.type === "success" ? "✓" : "✗"}</span><span>{t.message}</span></div>)}</div>
      <WorkspaceSelector token={token} addToast={addToast} onSelect={(ws) => setSelectedWorkspace(ws)} onLogout={handleLogout} theme={theme} toggleTheme={toggleTheme} />
    </>
  );

  // ─── Board View Helpers ───────────────
  const wsId = selectedWorkspace.id;

  const addTicket = () => setTickets([...tickets, { id: tickets.length + 1, task: "", deadline: "", priority: "", dependency: 0 }]);
  const removeTicket = (i) => { if (tickets.length > 1) setTickets(tickets.filter((_, idx) => idx !== i)); };
  const handleChange = (i, f, v) => { const u = [...tickets]; u[i][f] = v; setTickets(u); };

  const submitTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/tickets?workspace_id=${wsId}`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ tickets }) });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail || "Submit failed"); return; }
      setExecutionOrder(data.execution_order || []);
      const cols = {}; tickets.forEach((t) => (cols[t.id] = "created")); setTicketColumns(cols);
      setSubmitted(true); addToast("success", "Tickets submitted!");
    } catch { addToast("error", "Backend unreachable"); }
    finally { setLoading(false); }
  };

  const canMoveTo = (ticketId, targetCol) => {
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return { allowed: false };
    if (targetCol === "created" || targetCol === "not_completed") return { allowed: true };
    const depId = ticket.dependency;
    if (depId && depId !== 0) {
      const depColumn = ticketColumns[depId];
      if (depColumn !== "completed") {
        const depTicket = tickets.find((t) => t.id === depId);
        return { allowed: false, depId, depTask: depTicket?.task || `#${depId}`, depStatus: depColumn || "created" };
      }
    }
    return { allowed: true };
  };

  const handleDragOver = (colId) => { if (draggingId === null) return; const r = canMoveTo(draggingId, colId); setDragOverCol(colId); setDragBlocked(!r.allowed); };
  const handleDragLeave = () => { setDragOverCol(null); setDragBlocked(false); };

  const handleDrop = async (ticketId, targetCol) => {
    setDragOverCol(null); setDragBlocked(false); setDraggingId(null);
    if (ticketColumns[ticketId] === targetCol) return;
    const result = canMoveTo(ticketId, targetCol);
    if (!result.allowed) { setModal({ taskId: ticketId, dependencyId: result.depId, dependencyTask: result.depTask, dependencyStatus: result.depStatus }); return; }
    setTicketColumns((prev) => ({ ...prev, [ticketId]: targetCol }));
    const statusMap = { created: "pending", pending: "pending", completed: "completed", not_completed: "not_completed" };
    try {
      await fetch(`${API}/status?workspace_id=${wsId}`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ task_id: ticketId, status: statusMap[targetCol] }) });
      const labels = { created: "Created", pending: "Pending", completed: "Completed", not_completed: "Not Completed" };
      addToast(targetCol === "completed" ? "success" : targetCol === "not_completed" ? "warning" : "success", `Ticket #${ticketId} → ${labels[targetCol]}`);
    } catch { addToast("error", "Failed to sync status"); }
  };

  const generateStandup = async () => {
    setStandupLoading(true);
    try { const res = await fetch(`${API}/ai/standup?workspace_id=${wsId}`, { method: "POST", headers: authHeaders(token) }); const data = await res.json(); setStandupText(data.summary); addToast("success", `Standup (${data.source})`); }
    catch { addToast("error", "Failed"); } finally { setStandupLoading(false); }
  };

  const analyzeRisks = async () => {
    setRiskLoading(true);
    try { const res = await fetch(`${API}/ai/risk-analysis?workspace_id=${wsId}`, { method: "POST", headers: authHeaders(token) }); const data = await res.json(); setRisks(data.risks || []); setRiskSummary(data.ai_summary || ""); addToast(data.risks?.length ? "warning" : "success", data.risks?.length ? `${data.risks.length} risk(s)` : "No risks!"); }
    catch { addToast("error", "Failed"); } finally { setRiskLoading(false); }
  };

  const handleClearBoard = async () => {
    setClearLoading(true);
    try {
      await fetch(`${API}/board?workspace_id=${wsId}`, { method: "DELETE", headers: authHeaders(token) });
      setTickets([{ id: 1, task: "", deadline: "", priority: "", dependency: 0 }]);
      setExecutionOrder([]); setTicketColumns({}); setSubmitted(false);
      addToast("success", "Board cleared!");
    } catch { addToast("error", "Failed"); }
    finally { setClearLoading(false); }
  };

  const handleInviteAction = async (inviteId, action) => {
    try {
      const res = await fetch(`${API}/workspaces/invitations/${inviteId}/${action}`, { method: "POST", headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail); return; }
      addToast("success", data.message);
      fetchInvitations();
    } catch { addToast("error", `Failed to ${action}`); }
  };

  // ─── GitHub Functions ──────────────────
  const handleGithubConnect = async () => {
    if (!githubPat.trim() || !githubRepo.trim()) {
      addToast("error", "Please enter both PAT and repo");
      return;
    }
    setGithubConnecting(true);
    try {
      const res = await fetch(`${API}/github/connect`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ pat: githubPat, repo: githubRepo }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail || "Connection failed"); return; }
      setGithubConnected(true);
      setGithubUsername(data.github_username || "");
      setGithubPat("");
      addToast("success", data.message);
    } catch { addToast("error", "Failed to connect to GitHub"); }
    finally { setGithubConnecting(false); }
  };

  const handleGithubDisconnect = async () => {
    try {
      await fetch(`${API}/github/disconnect`, { method: "POST", headers: authHeaders(token) });
      setGithubConnected(false);
      setGithubUsername("");
      setGithubRepo("");
      setGithubAnalysis(null);
      addToast("success", "GitHub disconnected");
    } catch { addToast("error", "Failed to disconnect"); }
  };

  const handleGithubAnalyze = async () => {
    setGithubAnalyzing(true);
    try {
      const res = await fetch(`${API}/github/analyze?workspace_id=${wsId}`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ repo: githubRepo || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail || "Analysis failed"); return; }
      setGithubAnalysis(data);
      setShowGithub(false);
      addToast("success", `Found ${data.matches?.length || 0} commit-ticket match(es)`);
    } catch { addToast("error", "Failed to analyze commits"); }
    finally { setGithubAnalyzing(false); }
  };

  const handleGithubApply = async () => {
    if (!githubAnalysis?.matches?.length) return;
    setGithubApplying(true);
    try {
      const changes = githubAnalysis.matches.map((m) => ({
        ticket_id: m.ticket_id,
        new_status: m.suggested_status,
      }));
      const res = await fetch(`${API}/github/apply?workspace_id=${wsId}`, {
        method: "POST", headers: authHeaders(token),
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) { addToast("error", data.detail || "Apply failed"); return; }
      // Update local state
      const newCols = { ...ticketColumns };
      for (const c of data.applied || []) {
        newCols[c.ticket_id] = c.new_status;
      }
      setTicketColumns(newCols);
      addToast("success", data.message);
      setGithubAnalysis(null);
    } catch { addToast("error", "Failed to apply changes"); }
    finally { setGithubApplying(false); }
  };

  return (
    <>
      <div className="toast-container">{toasts.map((t) => (<div key={t.id} className={`toast ${t.type} ${t.exit ? "exit" : ""}`}><span className="icon">{t.type === "success" ? "✓" : t.type === "error" ? "✗" : "⚠"}</span><span>{t.message}</span></div>))}</div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">⚠️</div>
            <h2>Cannot Move Ticket</h2>
            <p><strong>Ticket #{modal.taskId}</strong> depends on <strong>Ticket #{modal.dependencyId}</strong> which must be <strong>Completed</strong> first.</p>
            <div className="dep-info">
              <div className="dep-row"><span className="dep-label">Blocking Ticket</span><span>#{modal.dependencyId}</span></div>
              <div className="dep-row"><span className="dep-label">Task</span><span>{modal.dependencyTask}</span></div>
              <div className="dep-row"><span className="dep-label">Status</span><span style={{ color: "#f87171", textTransform: "uppercase" }}>{modal.dependencyStatus}</span></div>
            </div>
            <div className="modal-actions"><button className="btn-modal btn-modal-dismiss" onClick={() => setModal(null)}>Got it</button></div>
          </div>
        </div>
      )}

      <div className="app">
        <div className="header">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1>SprintFlow</h1>
              <div className="subtitle">{selectedWorkspace.name}{viewingMember ? ` — viewing ${viewingMember.email}'s board` : ""}</div>
            </div>
            <div className="user-bar">
              <button className="btn btn-ghost btn-theme" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
              {/* GitHub Button */}
              <div className="github-wrap">
                <button className={`btn-github ${githubConnected ? "connected" : ""}`} onClick={() => setShowGithub(!showGithub)}>
                  <svg className="github-icon" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                  {githubConnected ? <><span className="github-status-dot" />GitHub ✓</> : "Connect to GitHub"}
                </button>
                {showGithub && (
                  <div className="github-dropdown">
                    <div className="github-dropdown-header">
                      <span>GitHub Integration</span>
                      <button className="btn btn-ghost" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => setShowGithub(false)}>✕</button>
                    </div>
                    <div className="github-dropdown-body">
                      {githubConnected ? (
                        <>
                          <div className="github-connected-info">
                            <span className="github-status-dot" />
                            <span className="github-connected-text">@{githubUsername}</span>
                            <span className="github-connected-repo">{githubRepo}</span>
                          </div>
                          <div>
                            <div className="github-input-label">Repository (owner/repo)</div>
                            <input className="input" placeholder="owner/repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
                          </div>
                          <div className="github-dropdown-actions">
                            <button className="btn btn-github-connect" onClick={handleGithubAnalyze} disabled={githubAnalyzing}>
                              {githubAnalyzing ? <><span className="spinner" /> Analyzing…</> : "🔍 Analyze Commits"}
                            </button>
                            <button className="btn btn-github-disconnect" onClick={handleGithubDisconnect}>✕</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <div className="github-input-label">Personal Access Token</div>
                            <input className="input" type="password" placeholder="ghp_xxxxxxxxxxxx" value={githubPat} onChange={(e) => setGithubPat(e.target.value)} />
                          </div>
                          <div>
                            <div className="github-input-label">Repository (owner/repo)</div>
                            <input className="input" placeholder="owner/repo" value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} />
                          </div>
                          <div className="github-dropdown-actions">
                            <button className="btn btn-github-connect" onClick={handleGithubConnect} disabled={githubConnecting}>
                              {githubConnecting ? <><span className="spinner" /> Connecting…</> : "🔗 Connect"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {/* Notification Bell */}
              <div className="notif-wrap">
                <button className="btn btn-ghost btn-notif" onClick={() => { setShowNotif(!showNotif); fetchInvitations(); }}>
                  🔔 {invitations.length > 0 && <span className="notif-count">{invitations.length}</span>}
                </button>
                {showNotif && (
                  <div className="notif-dropdown">
                    <div className="notif-header">Invitations</div>
                    {invitations.length === 0 ? <div className="notif-empty">No pending invitations</div> : invitations.map((inv) => (
                      <div key={inv.id} className="notif-item">
                        <div className="notif-item-text">Invited to <strong>{inv.workspace_name}</strong></div>
                        <div className="notif-actions">
                          <button className="btn-notif-accept" onClick={() => handleInviteAction(inv.id, "accept")}>✓</button>
                          <button className="btn-notif-reject" onClick={() => handleInviteAction(inv.id, "reject")}>✗</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="user-email">{userEmail}</span>
              <button className="btn btn-ghost" onClick={() => {
                setSelectedWorkspace(null); setSubmitted(false);
                setTickets([{ id: 1, task: "", deadline: "", priority: "", dependency: 0 }]);
                setExecutionOrder([]); setTicketColumns({});
                setStandupText(null); setRisks([]); setRiskSummary("");
                setViewingMember(null); setTeamMembers([]);
              }}>← Workspaces</button>
              <button className="btn btn-ghost btn-logout" onClick={handleLogout}>Logout ↗</button>
            </div>
          </div>
        </div>

        {/* Active Meeting Banner */}
        {activeMeetings.filter((m) => m.workspace_id === selectedWorkspace?.id).map((m) => (
          <div key={m.id} className="meeting-banner-wrap">
            <div className="meeting-banner">
              <div className="meeting-banner-left">
                <span className="meeting-live-dot" />
                <span className="meeting-banner-label">LIVE</span>
                <span className="meeting-banner-title">{m.title}</span>
                <span className="meeting-banner-meta">by {m.created_by}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {speechSupported ? (
                  <button
                    className={`btn btn-mic ${isRecording ? 'recording' : ''}`}
                    onClick={() => isRecording ? stopRecording() : startRecording(m.id)}
                  >
                    {isRecording ? '🔴 Stop' : '🎤 Start Notes'}
                  </button>
                ) : null}
                <a href={m.jitsi_link} target="_blank" rel="noopener noreferrer" className="btn btn-join-meet">
                  🎥 Join Call
                </a>
              </div>
            </div>
            {/* Transcription bar */}
            {(isRecording || !speechSupported) && (
              <div className="transcription-bar">
                {isRecording && liveTranscript && (
                  <div className="transcript-preview">
                    <span className="transcript-preview-dot" />
                    {liveTranscript}
                  </div>
                )}
                {isRecording && !liveTranscript && (
                  <div className="transcript-preview">
                    <span className="transcript-preview-dot" />
                    Listening… speak now
                  </div>
                )}
                <div className="manual-note-row">
                  <input
                    className="input manual-note-input"
                    placeholder={speechSupported ? "Or type a note manually…" : "Type your meeting note…"}
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendManualNote(m.id)}
                  />
                  <button className="btn btn-ghost btn-send-note" onClick={() => sendManualNote(m.id)}>↑ Send</button>
                </div>
              </div>
            )}
            {!isRecording && speechSupported && (
              <div className="transcription-hint">Click 🎤 Start Notes to transcribe your speech during the call</div>
            )}
          </div>
        ))}

        {/* Team Members Panel */}
        {teamMembers.length > 0 && (
          <div className="team-panel">
            <div className="team-panel-label"><span className="accent-dot" style={{ background: "#6366f1" }} />Team Members ({teamMembers.length})</div>
            <div className="team-members-row">
              {teamMembers.map((m) => (
                <button
                  key={m.id}
                  className={`team-member-card ${m.is_current_user && !viewingMember ? "active" : ""} ${viewingMember?.id === m.id ? "active viewing" : ""}`}
                  onClick={() => viewMemberBoard(m)}
                >
                  <span className="team-member-avatar">{m.email[0].toUpperCase()}</span>
                  <span className="team-member-email">{m.is_current_user ? "Me" : m.email.split("@")[0]}</span>
                  {m.is_current_user && <span className="team-member-you">YOU</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Analytics Dashboard ─── */}
        {analytics && analytics.total_tickets > 0 && (
          <div className="analytics-dashboard">
            <div className="section-label"><span className="accent-dot" style={{ background: "#6366f1" }} />📊 Project Analytics</div>

            <div className="analytics-grid">
              {/* Stat Cards */}
              <div className="stat-card">
                <div className="stat-value">{analytics.total_tickets}</div>
                <div className="stat-label">Total Tickets</div>
                <div className="stat-icon">🎫</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{analytics.completion_pct}%</div>
                <div className="stat-label">Completed</div>
                <div className="stat-icon">✅</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{analytics.team_size}</div>
                <div className="stat-label">Team Size</div>
                <div className="stat-icon">👥</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{analytics.status.pending}</div>
                <div className="stat-label">In Progress</div>
                <div className="stat-icon">⏳</div>
              </div>

              {/* Donut Chart — Status Distribution */}
              <div className="chart-card chart-donut-card">
                <div className="chart-title">Status Distribution</div>
                <svg viewBox="0 0 200 200" className="donut-chart">
                  {(() => {
                    const s = analytics.status;
                    const total = s.created + s.pending + s.completed + s.not_completed || 1;
                    const segments = [
                      { value: s.created, color: "#94a3b8", label: "Created" },
                      { value: s.pending, color: "#6366f1", label: "Pending" },
                      { value: s.completed, color: "#22c55e", label: "Completed" },
                      { value: s.not_completed, color: "#ef4444", label: "Not Done" },
                    ];
                    let cumulative = 0;
                    const R = 70, cx = 100, cy = 100;
                    return segments.filter(seg => seg.value > 0).map((seg, i) => {
                      const pct = seg.value / total;
                      const startAngle = cumulative * 2 * Math.PI - Math.PI / 2;
                      cumulative += pct;
                      const endAngle = cumulative * 2 * Math.PI - Math.PI / 2;
                      const largeArc = pct > 0.5 ? 1 : 0;
                      const x1 = cx + R * Math.cos(startAngle);
                      const y1 = cy + R * Math.sin(startAngle);
                      const x2 = cx + R * Math.cos(endAngle);
                      const y2 = cy + R * Math.sin(endAngle);
                      return <path key={i} d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} Z`} fill={seg.color} opacity="0.85" stroke="white" strokeWidth="2" />;
                    });
                  })()}
                  <circle cx="100" cy="100" r="40" fill="var(--bg-primary)" />
                  <text x="100" y="96" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--text-primary)">{analytics.completion_pct}%</text>
                  <text x="100" y="114" textAnchor="middle" fontSize="10" fill="var(--text-muted)">done</text>
                </svg>
                <div className="donut-legend">
                  <span><span className="legend-dot" style={{ background: "#94a3b8" }} />Created ({analytics.status.created})</span>
                  <span><span className="legend-dot" style={{ background: "#6366f1" }} />Pending ({analytics.status.pending})</span>
                  <span><span className="legend-dot" style={{ background: "#22c55e" }} />Done ({analytics.status.completed})</span>
                  <span><span className="legend-dot" style={{ background: "#ef4444" }} />Failed ({analytics.status.not_completed})</span>
                </div>
              </div>

              {/* Priority Breakdown */}
              <div className="chart-card chart-priority-card">
                <div className="chart-title">Priority Breakdown</div>
                <div className="priority-bars">
                  {[
                    { label: "High", value: analytics.priority.high, color: "#ef4444" },
                    { label: "Medium", value: analytics.priority.medium, color: "#f59e0b" },
                    { label: "Low", value: analytics.priority.low, color: "#22c55e" },
                  ].map((p) => {
                    const maxVal = Math.max(analytics.priority.high, analytics.priority.medium, analytics.priority.low, 1);
                    return (
                      <div key={p.label} className="priority-bar-row">
                        <span className="priority-bar-label">{p.label}</span>
                        <div className="priority-bar-track">
                          <div className="priority-bar-fill" style={{ width: `${(p.value / maxVal) * 100}%`, background: p.color }} />
                        </div>
                        <span className="priority-bar-count">{p.value}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Team Workload */}
              <div className="chart-card chart-team-card">
                <div className="chart-title">Team Workload</div>
                <div className="team-workload-list">
                  {analytics.team.map((m) => (
                    <div key={m.user_id} className="team-workload-row">
                      <div className="team-workload-header">
                        <span className="team-workload-avatar">{m.email[0].toUpperCase()}</span>
                        <span className="team-workload-name">{m.email.split("@")[0]}</span>
                        <span className="team-workload-pct">{m.completion_pct}%</span>
                      </div>
                      <div className="team-workload-bar-track">
                        <div className="team-workload-bar-completed" style={{ width: `${m.total > 0 ? (m.completed / m.total) * 100 : 0}%` }} />
                        <div className="team-workload-bar-pending" style={{ width: `${m.total > 0 ? (m.pending / m.total) * 100 : 0}%` }} />
                        <div className="team-workload-bar-created" style={{ width: `${m.total > 0 ? (m.created / m.total) * 100 : 0}%` }} />
                      </div>
                      <div className="team-workload-meta">{m.completed}/{m.total} tasks done</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Read-only Banner */}
        {isReadOnly && (
          <div className="readonly-banner">
            <span>👁 Viewing <strong>{viewingMember.email}</strong>'s board (read-only)</span>
            <button className="btn btn-ghost btn-back-to-mine" onClick={backToMyBoard}>← Back to My Board</button>
          </div>
        )}

        {/* Ticket Form */}
        {!isReadOnly && (
          <div className="glass-card">
            <div className="section-label"><span className="accent-dot" />Tickets</div>
            <div className="ticket-header">{["Task", "Deadline", "Priority", "Depends on ID", ""].map((h) => <span key={h}>{h}</span>)}</div>
            {tickets.map((ticket, index) => (
              <div key={index} className="ticket-row" style={{ animationDelay: `${index * 0.05}s` }}>
                <input className="input" placeholder={`Task ${ticket.id}`} value={ticket.task} onChange={(e) => handleChange(index, "task", e.target.value)} />
                <input className="input" type="date" value={ticket.deadline} onChange={(e) => handleChange(index, "deadline", e.target.value)} />
                <input className="input" placeholder="high / medium / low" value={ticket.priority} onChange={(e) => handleChange(index, "priority", e.target.value)} />
                <input className="input" type="number" placeholder="0 = none" value={ticket.dependency} min={0} onChange={(e) => handleChange(index, "dependency", Number(e.target.value))} />
                <button className="btn btn-remove" onClick={() => removeTicket(index)} title="Remove">×</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn btn-ghost" onClick={addTicket}>+ Add Ticket</button>
              <button className="btn btn-primary" onClick={submitTickets} disabled={loading}>
                {loading ? <><span className="spinner" /> Processing…</> : "Submit →"}
              </button>
            </div>
          </div>
        )}

        <DependencyGraph tickets={tickets} ticketColumns={ticketColumns} />

        {executionOrder.length > 0 && (
          <><hr className="divider" /><div className="glass-card"><div className="section-label"><span className="accent-dot" />Execution Order</div><div className="exec-flow">{executionOrder.map((id, i) => (<span key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="exec-node">{id}</span>{i < executionOrder.length - 1 && <span className="exec-arrow">→</span>}</span>))}</div></div></>
        )}

        {/* AI Actions */}
        {submitted && !isReadOnly && (
          <>
            <hr className="divider" />
            <div className="ai-actions-bar">
              <div className="section-label" style={{ margin: 0 }}><span className="accent-dot" style={{ background: "#a78bfa" }} />AI Insights</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn btn-ai" onClick={generateStandup} disabled={standupLoading}>{standupLoading ? <><span className="spinner" /> Generating…</> : "⚡ Daily Standup"}</button>
                <button className="btn btn-ai btn-ai-risk" onClick={analyzeRisks} disabled={riskLoading}>{riskLoading ? <><span className="spinner" /> Analyzing…</> : "🚨 Risk Analysis"}</button>
              </div>
            </div>
            {standupText && (
              <div className="glass-card standup-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div className="section-label" style={{ margin: 0 }}><span className="accent-dot" style={{ background: "#22c55e" }} />Standup Summary</div>
                  <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => setStandupText(null)}>✕</button>
                </div>
                <div className="standup-content" dangerouslySetInnerHTML={{ __html: standupText.replace(/\n/g, '<br/>').replace(/##\s(.+)/g, '<h3>$1</h3>').replace(/###\s(.+)/g, '<h4>$1</h4>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^- (.+)/gm, '<li>$1</li>') }} />
              </div>
            )}
            {riskSummary && (
              <div className="glass-card risk-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div className="section-label" style={{ margin: 0 }}><span className="accent-dot" style={{ background: "#ef4444" }} />Risk Analysis — {risks.length} issue{risks.length !== 1 ? "s" : ""}</div>
                  <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => { setRiskSummary(""); setRisks([]); }}>✕</button>
                </div>
                <div className="standup-content" dangerouslySetInnerHTML={{ __html: riskSummary.replace(/\n/g, '<br/>').replace(/##\s(.+)/g, '<h3>$1</h3>').replace(/###\s(.+)/g, '<h4>$1</h4>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^- (.+)/gm, '<li>$1</li>') }} />
              </div>
            )}
          </>
        )}

        {/* GitHub Commit Analysis Results */}
        {githubAnalysis && !isReadOnly && (
          <div className="glass-card github-analysis-card">
            <div className="github-analysis-header">
              <div className="section-label" style={{ margin: 0 }}><span className="accent-dot" style={{ background: "#a78bfa" }} />GitHub Commit Analysis</div>
              <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 10px" }} onClick={() => setGithubAnalysis(null)}>✕</button>
            </div>
            {githubAnalysis.ai_summary && (
              <div className="github-analysis-summary">{githubAnalysis.ai_summary}</div>
            )}
            {githubAnalysis.matches?.length > 0 ? (
              <>
                <div className="commit-matches-list">
                  {githubAnalysis.matches.map((m, i) => (
                    <div key={i} className="commit-match-row">
                      <span className="commit-match-arrow">→</span>
                      <div className="commit-match-details">
                        <div><span className="commit-sha">{m.commit_sha}</span><span className="commit-msg">{m.commit_message}</span></div>
                        <div className="commit-match-ticket">→ Ticket #{m.ticket_id}: {m.ticket_task}
                          <span className={`commit-match-confidence confidence-${m.confidence || "medium"}`}>{m.confidence || "medium"}</span>
                        </div>
                        <div className="commit-match-reason">{m.reason}</div>
                      </div>
                      <span className={`commit-match-status-tag status-${m.suggested_status}`}>{m.suggested_status}</span>
                    </div>
                  ))}
                </div>
                <div className="github-apply-bar">
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#475569" }}>
                    {githubAnalysis.matches.length} change{githubAnalysis.matches.length !== 1 ? "s" : ""} to apply
                  </span>
                  <button className="btn btn-github-apply" onClick={handleGithubApply} disabled={githubApplying}>
                    {githubApplying ? <><span className="spinner" /> Applying…</> : "⚡ Apply Changes to Board"}
                  </button>
                </div>
              </>
            ) : (
              <div className="no-matches-msg">No commits matched any tickets on this board.</div>
            )}
          </div>
        )}

        {/* Kanban Board */}
        {submitted && (
          <>
            <div className="section-label" style={{ paddingLeft: 4 }}><span className="accent-dot" />Kanban Board{isReadOnly ? " (Read-Only)" : " — Drag to update"}</div>
            <div className={`kanban-board ${isReadOnly ? "readonly" : ""}`} onDragEnd={() => { setDraggingId(null); setDragOverCol(null); setDragBlocked(false); }}>
              {COLUMNS.map((col) => (
                <KanbanColumn key={col.id} col={col} tickets={ticketsByColumn[col.id]} onDrop={isReadOnly ? () => { } : handleDrop} onDragOver={isReadOnly ? (e) => e.preventDefault() : handleDragOver} onDragLeave={isReadOnly ? () => { } : handleDragLeave}
                  dragOverState={dragOverCol === col.id ? (dragBlocked ? "blocked" : "allowed") : null} draggingId={draggingId} onDragStart={isReadOnly ? () => { } : setDraggingId} riskMap={riskMap} />
              ))}
            </div>
            {!isReadOnly && (
              <div className="clear-section">
                <button className="btn btn-clear" onClick={handleClearBoard} disabled={clearLoading}>
                  {clearLoading ? <><span className="spinner" /> Clearing…</> : "🗑 Clear Board — Everything is Done"}
                </button>
                <p className="clear-hint">This will permanently remove all tickets and reset the board.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
