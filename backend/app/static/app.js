const API = "";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Needs Review (P1/P2)" },
  { id: "investigating", label: "Investigating" },
  { id: "escalated", label: "Escalated" },
  { id: "resolved", label: "Resolved" },
  { id: "rejected", label: "Rejected" },
];

const STAGES = ["Ingest", "Validate", "Dedup", "Prioritize", "Assign", "Investigate", "Review", "Resolve"];

const state = {
  alerts: [],
  stats: null,
  selectedId: null,
  statusFilter: "all",
  llmProviders: null,
};

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) throw new Error(await res.text() || res.statusText);
  return res.json();
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3500);
}

function statusStage(status) {
  const map = {
    received: 0, validated: 1, deduplicated: 2, duplicate: 2, rejected: 2,
    prioritized: 3, assigned: 4, investigating: 5, pending_review: 6,
    escalated: 6, resolved: 7,
  };
  return map[status] ?? 0;
}

function renderStats() {
  const s = state.stats;
  const row = document.getElementById("stats-row");
  if (!s) { row.innerHTML = ""; return; }
  const teams = Object.keys(s.by_team || {}).length;
  row.innerHTML = [
    ["Total Alerts", s.total_alerts],
    ["Investigating", s.by_status?.investigating ?? 0],
    ["Resolved", s.by_status?.resolved ?? 0],
    ["Teams Active", teams],
  ].map(([label, value]) => `
    <div class="stat-card"><span>${label}</span><strong>${value}</strong></div>
  `).join("");
}

function renderFilters() {
  const counts = { all: state.alerts.length, ...(state.stats?.by_status || {}) };
  document.getElementById("filter-tabs").innerHTML = FILTERS.map((f) => `
    <button type="button" data-filter="${f.id}" class="${state.statusFilter === f.id ? "active" : ""}">
      ${f.label}${counts[f.id] != null ? ` (${counts[f.id]})` : ""}
    </button>
  `).join("");
  document.querySelectorAll("#filter-tabs button").forEach((btn) => {
    btn.onclick = () => {
      state.statusFilter = btn.dataset.filter;
      renderFilters();
      renderAlertList();
    };
  });
}

function filteredAlerts() {
  if (state.statusFilter === "all") return state.alerts;
  return state.alerts.filter((a) => a.status === state.statusFilter);
}

function renderAlertList() {
  const list = filteredAlerts();
  document.getElementById("alert-count").textContent = list.length;
  const container = document.getElementById("alert-list");
  if (!list.length) {
    container.innerHTML = `<p class="muted" style="padding:1rem;text-align:center;color:#64748b">
      No alerts yet. Run <code>python scripts/trigger_alerts.py</code> to ingest dummy data.</p>`;
    return;
  }
  container.innerHTML = list.map((a) => `
    <button type="button" class="alert-item ${state.selectedId === a.id ? "selected" : ""}" data-id="${a.id}">
      <h3>${esc(a.title)}</h3>
      <div class="meta">
        <span class="badge badge-${a.severity}">${a.severity}</span>
        <span>P${a.priority}</span>
        <span>${a.team}</span>
        ${a.status === "pending_review" ? '<span class="badge badge-pending">review</span>' : `<span>${a.status.replace("_", " ")}</span>`}
      </div>
    </button>
  `).join("");
  container.querySelectorAll(".alert-item").forEach((el) => {
    el.onclick = () => {
      state.selectedId = el.dataset.id;
      renderAlertList();
      renderDetail();
    };
  });
}

function renderDetail() {
  const box = document.getElementById("alert-detail");
  const alert = state.alerts.find((a) => a.id === state.selectedId);
  if (!alert) {
    box.className = "alert-detail empty";
    box.innerHTML = `<p>Select an alert to review LLM investigation</p><p class="muted">P1/P2 require approval · P3+ auto-resolve</p>`;
    return;
  }
  box.className = "alert-detail";
  const stage = statusStage(alert.status);
  const pipeline = STAGES.map((label, i) => {
    const cls = i < stage ? "done" : i === stage ? "active" : "";
    return `<span class="${cls}">${label}</span>`;
  }).join("");

  let invHtml = "";
  if (alert.investigation) {
    const inv = alert.investigation;
    invHtml = `<div class="investigation">
      <strong style="color:#6ee7b7">LLM Investigation</strong>
      <h4>Root Cause</h4><p>${esc(inv.root_cause)}</p>
      <h4>Impact</h4><p>${esc(inv.impact_assessment)}</p>
      <h4>Recommendations</h4><ul>${inv.recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <p style="color:#fbbf24">Urgency: ${inv.urgency_score}/10</p>
    </div>`;
  } else if (alert.status === "investigating") {
    invHtml = `<p style="color:#fbbf24;animation:pulse 2s infinite">LLM is investigating…</p>`;
  }

  let reviewHtml = "";
  if (alert.human_review && alert.status !== "escalated") {
    const hr = alert.human_review;
    const auto = hr.reviewer === "system-auto-resolve";
    reviewHtml = `<div class="review-panel ${auto ? "auto" : "human"}">
      <strong>${auto ? "Auto-Resolved" : `Human Review — ${hr.decision}`}</strong>
      <p style="font-size:0.875rem;color:#94a3b8">${auto ? "Resolved by pipeline policy" : `Reviewer: ${esc(hr.reviewer)}`}</p>
      ${hr.feedback ? `<p style="font-size:0.875rem;color:#94a3b8;border-left:2px solid #475569;padding-left:0.75rem">${esc(hr.feedback)}</p>` : ""}
    </div>`;
  } else if (["pending_review", "investigating", "escalated"].includes(alert.status)) {
    reviewHtml = `<div class="review-panel human">
      <strong style="color:#fcd34d">Human-in-the-Loop Review</strong>
      <p style="font-size:0.75rem;color:#94a3b8">P1/P2 alerts require your approval.</p>
      <label style="font-size:0.75rem;color:#64748b">Reviewer</label>
      <input id="reviewer" value="on-call-engineer" />
      <label style="font-size:0.75rem;color:#64748b">Feedback</label>
      <textarea id="feedback" rows="2" placeholder="Optional notes…"></textarea>
      <div class="review-actions">
        <button type="button" class="btn-approve" data-decision="approve">Approve</button>
        <button type="button" class="btn-reject" data-decision="reject">Reject</button>
        <button type="button" class="btn-escalate" data-decision="escalate">Escalate</button>
      </div>
    </div>`;
  }

  box.innerHTML = `
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.5rem">
      <span class="badge badge-${alert.severity}">${alert.severity}</span>
      <span class="badge">P${alert.priority}</span>
      <span style="text-transform:capitalize;color:#94a3b8">${alert.status.replace("_", " ")}</span>
    </div>
    <h2 style="margin:0.25rem 0">${esc(alert.title)}</h2>
    <p style="color:#94a3b8">${esc(alert.description)}</p>
    <div class="pipeline">${pipeline}</div>
    <p style="font-size:0.875rem;color:#64748b">${alert.service} · ${alert.environment} · ${alert.team}</p>
    ${invHtml}${reviewHtml}
  `;

  box.querySelectorAll(".review-actions button").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/api/v1/alerts/${alert.id}/human-review`, {
          method: "POST",
          body: JSON.stringify({
            decision: btn.dataset.decision,
            reviewer: document.getElementById("reviewer").value,
            feedback: document.getElementById("feedback").value,
          }),
        });
        showToast(`Alert ${btn.dataset.decision}d`);
        await refresh();
      } catch (e) {
        showToast(e.message);
      }
    };
  });
}

async function loadLlm() {
  try {
    state.llmProviders = await api("/api/v1/llm/providers");
    const sel = document.getElementById("llm-select");
    const active = state.llmProviders.active_provider;
    sel.innerHTML = state.llmProviders.providers.map((p) => `
      <option value="${p.id}" ${p.id === active ? "selected" : ""}>
        ${p.label}${p.is_default ? " (default)" : ""}${p.free ? " · free" : ""}
      </option>
    `).join("");
    updateLlmStatus();
    sel.onchange = async () => {
      const r = await api("/api/v1/llm/provider", {
        method: "PUT",
        body: JSON.stringify({ provider: sel.value }),
      });
      showToast(r.message);
      await loadLlm();
    };
  } catch (_) {
    document.getElementById("llm-status").textContent = "LLM config unavailable";
  }
}

function updateLlmStatus() {
  const el = document.getElementById("llm-status");
  const p = state.llmProviders?.providers.find((x) => x.id === state.llmProviders.active_provider);
  if (!p) return;
  if (p.id === "offline") {
    el.textContent = "Offline fallback · no API key needed";
    el.className = "llm-status ok";
  } else if (p.configured) {
    el.textContent = `${p.label} · ${p.model}`;
    el.className = "llm-status ok";
  } else {
    el.textContent = `No API key — ${p.key_hint}`;
    el.className = "llm-status warn";
  }
}

async function refresh() {
  const banner = document.getElementById("error-banner");
  try {
    const [alertsData, stats] = await Promise.all([
      api("/api/v1/alerts?limit=100"),
      api("/api/v1/alerts/stats"),
    ]);
    state.alerts = alertsData.items;
    state.stats = stats;
    banner.classList.add("hidden");
    renderStats();
    renderFilters();
    renderAlertList();
    renderDetail();
  } catch (e) {
    banner.textContent = `Cannot reach API: ${e.message}`;
    banner.classList.remove("hidden");
  }
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

// Chat
const chatModal = document.getElementById("chat-modal");
document.getElementById("chat-fab").onclick = () => chatModal.classList.remove("hidden");
document.getElementById("chat-close").onclick = () => chatModal.classList.add("hidden");
document.querySelector(".chat-backdrop").onclick = () => chatModal.classList.add("hidden");

const chatMessages = document.getElementById("chat-messages");
chatMessages.innerHTML = `<div class="chat-msg bot">Hi! Ask about alerts, investigations, or human-review steps.</div>`;

document.getElementById("chat-form").onsubmit = async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  chatMessages.innerHTML += `<div class="chat-msg user">${esc(text)}</div>`;
  chatMessages.scrollTop = chatMessages.scrollHeight;
  try {
    const r = await api("/api/v1/chat", {
      method: "POST",
      body: JSON.stringify({ message: text, alert_id: state.selectedId }),
    });
    chatMessages.innerHTML += `<div class="chat-msg bot">${esc(r.reply)}</div>`;
  } catch (err) {
    chatMessages.innerHTML += `<div class="chat-msg bot">Error: ${esc(err.message)}</div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

document.getElementById("btn-refresh").onclick = refresh;

loadLlm();
refresh();
setInterval(refresh, 4000);
