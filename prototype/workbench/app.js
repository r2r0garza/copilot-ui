// PROTOTYPE — three disposable IA directions for the VS Code Agent Workbench.
const variants = {
  A: "Conversation studio",
  B: "Task command center",
  C: "Context navigator",
};

const state = {
  taskStatus: "running",
  activeInspector: "Ledger",
  mode: "Chat",
  selectedSession: "Workbench navigation",
  corrected: false,
  bArea: "Tasks",
};

const icon = (name) => ({
  chat: "◌", task: "◆", history: "↗", agents: "◎", memory: "◇", settings: "⚙",
}[name] ?? "•");

const badge = (text, tone = "") => `<span class="badge ${tone}"><span class="dot"></span>${text}</span>`;

function titlebar(context) {
  return `<header class="titlebar">
    <strong>Bridgit</strong>
    <span class="repo">bridgit-ui</span>
    <span class="grow"></span>
    ${badge("Task owns write lock", "amber")}
    <span class="muted">${context}</span>
  </header>`;
}

function taskSummary(compact = false) {
  return `<section class="${compact ? "" : "card"} stack">
    <div class="spread">
      <div>
        <div class="small muted">ACTIVE TASK · TASK-024</div>
        <strong>Implement durable session storage</strong>
      </div>
      ${badge(state.taskStatus === "running" ? "Running" : "Pausing safely", state.taskStatus === "running" ? "green" : "amber")}
    </div>
    <div class="progress"><span></span></div>
    <div class="spread small muted">
      <span>7 of 12 subtasks complete</span><span>32 min · 18.4k tokens</span>
    </div>
  </section>`;
}

function taskControls() {
  return `<div class="task-controls">
    <button data-action="pause">${state.taskStatus === "running" ? "Pause safely" : "Resume"}</button>
    <button class="danger" data-action="stop">Stop task</button>
    <button>⋯</button>
  </div>`;
}

function driftNotice() {
  return `<div class="notice">
    <div class="spread"><strong>Repository drift needs review</strong>${badge("Task paused", "amber")}</div>
    <div class="small">Chat changed <span class="mono">src/store.ts</span> while the Task lock was released. Compare the new baseline before reactivation.</div>
    <div class="row" style="margin-top:8px"><button>Review changes</button><button>Replan affected work</button></div>
  </div>`;
}

function toolRecords() {
  return `<div>
    <details open>
      <summary><span class="mono">read_file</span> · completed · 42 ms</summary>
      <div class="small muted" style="padding:8px 4px">Read <span class="mono">src/store.ts</span> · repository-confined · no mutation</div>
    </details>
    <details>
      <summary><span class="mono">apply_patch</span> · completed · 186 ms</summary>
      <div class="small muted" style="padding:8px 4px">Modified 2 paths · session approval · outcome applied</div>
    </details>
    <details>
      <summary><span class="mono">npm test</span> · policy denied</summary>
      <div class="small muted" style="padding:8px 4px">Ambient command was outside this session's authority grant.</div>
    </details>
  </div>`;
}

function ledger() {
  return `<div>
    <div class="ledger-entry">
      <div class="spread"><strong>Storage uses SQLite</strong>${badge(state.corrected ? "Corrected" : "Active", state.corrected ? "amber" : "green")}</div>
      <div class="small muted">Decision · Assistant response · 4 min ago</div>
      <button class="ghost small" data-action="correct-ledger">${state.corrected ? "View correction" : "Correct or dispute"}</button>
    </div>
    <div class="ledger-entry">
      <div class="spread"><strong>Sessions are workspace-scoped</strong>${badge("Active", "green")}</div>
      <div class="small muted">Constraint · User message · 12 min ago</div>
    </div>
    <div class="ledger-entry">
      <div class="spread"><strong>Confirm migration behavior</strong>${badge("Open question", "blue")}</div>
      <div class="small muted">Question · Agent inference · 2 min ago</div>
    </div>
    <button style="margin-top:10px" data-action="promote">Promote to Memory…</button>
  </div>`;
}

function summaryProvenance() {
  return `<div class="stack">
    <div class="card">
      <div class="spread"><strong>Active summary v3</strong>${badge("In next context", "blue")}</div>
      <p class="small muted">Covers turns 1–38 and incorporates two ledger corrections.</p>
      <button>Inspect summary</button>
    </div>
    <div class="small muted">v2 · superseded · turns 1–26</div>
    <div class="small muted">v1 · superseded · turns 1–14</div>
    <p class="small faint">Raw turns are retained. Summary versions are immutable.</p>
  </div>`;
}

function chatMessages() {
  return `<div class="message">
      <div class="who">You · 10:42</div>
      <div>Can you update the storage design to handle interrupted attempts?</div>
    </div>
    <div class="message agent">
      <div class="who">Architecture Agent · Claude Sonnet 4.5 · 10:43</div>
      <p>I traced the current lifecycle and found one gap: the checkpoint record does not preserve completed Tool outcomes.</p>
      <p>I can prepare the patch, but this Chat is read-only while “Implement durable session storage” owns the repository lock.</p>
      <div class="notice blue small">Read-only Chat · Nothing will be queued to mutate later. You can continue reasoning or pause the Task.</div>
    </div>`;
}

function inspector() {
  const content = state.activeInspector === "Ledger" ? ledger()
    : state.activeInspector === "Tools" ? toolRecords() : summaryProvenance();
  return `<div class="inspector-tabs">${["Ledger", "Tools", "Summary"].map(tab =>
    `<button class="${state.activeInspector === tab ? "active" : ""}" data-inspector="${tab}">${tab}</button>`).join("")}</div>
    <div class="inspector-body">${content}</div>`;
}

function variantA() {
  return `<div class="app-shell">
    ${titlebar("Conversation studio")}
    <main class="a-grid">
      <aside class="a-sidebar">
        <div class="pane-head spread"><strong>Workbench</strong><button class="icon-button" aria-label="New chat">＋</button></div>
        <div class="list-section">
          <h3>Active task</h3>${taskSummary(true)}
        </div>
        <div class="divider"></div>
        <div class="list-section">
          <div class="spread"><h3>Chats</h3><span class="count">4</span></div>
          <button class="nav-item active">Workbench navigation<span class="meta">Architecture Agent · now</span></button>
          <button class="nav-item">Storage design<span class="meta">↳ Forked from Workbench navigation</span></button>
          <button class="nav-item">MCP tool policy<span class="meta">Security Agent · yesterday</span></button>
          <button class="nav-item">Onboarding notes<span class="meta">Docs Agent · Jul 20</span></button>
        </div>
        <div class="list-section">
          <button class="nav-item" data-action="trash">♲ Trash <span class="count">2</span></button>
          <button class="nav-item">${icon("memory")} Memories</button>
          <button class="nav-item">${icon("agents")} Agents & resources</button>
        </div>
      </aside>
      <section>
        <header class="chat-head spread">
          <div><strong>Workbench navigation</strong><div class="small muted">Architecture Agent · forked from “Extension architecture” at turn 18</div></div>
          <div class="row"><select aria-label="Model"><option>Claude Sonnet 4.5</option><option>Workbench Auto</option></select><button>Fork</button><button>⋯</button></div>
        </header>
        <div class="chat-stream">${chatMessages()}${driftNotice()}</div>
        <div class="composer"><textarea aria-label="Message" placeholder="Ask anything — repository mutation is unavailable"></textarea><div class="spread small"><span class="muted">🔒 Read-only while Task is running</span><button disabled>Send</button></div></div>
      </section>
      <aside class="a-inspector">${inspector()}</aside>
    </main>
  </div>`;
}

function bTasks() {
  return `
        <div class="task-hero">
          <div>${taskSummary(true)}</div>${taskControls()}
        </div>
        <div style="margin-top:12px">${driftNotice()}</div>
        <div class="board">
          <section class="column"><div class="spread"><h3>Ready</h3>${badge("2", "blue")}</div>
            <div class="subtask"><strong>Add checkpoint schema</strong><div class="small muted">Database Agent · read/write</div></div>
            <div class="subtask"><strong>Review recovery invariants</strong><div class="small muted">Architecture Agent · read-only</div></div>
          </section>
          <section class="column"><div class="spread"><h3>Running</h3>${badge("1", "green")}</div>
            <div class="subtask selected"><strong>Update session store</strong><div class="small muted">Database Agent · 8m 12s</div><div class="progress" style="margin-top:9px"><span></span></div></div>
          </section>
          <section class="column"><div class="spread"><h3>Blocked</h3>${badge("1", "amber")}</div>
            <div class="subtask"><strong>Run integration suite</strong><div class="small muted">Waiting for store update</div></div>
          </section>
          <section class="column"><div class="spread"><h3>Done</h3>${badge("7", "green")}</div>
            <div class="subtask"><strong>Map persistence API</strong><div class="small muted">Succeeded · 3 artifacts</div></div>
            <div class="subtask"><strong>Define recovery cases</strong><div class="small muted">Succeeded · 1 decision</div></div>
          </section>
        </div>
        <div class="b-lower">
          <section class="card">
            <div class="spread"><h2>Live execution</h2><button>Open full trace</button></div>
            <div class="event"><span class="small muted">10:44:08</span><span class="line"></span><div><strong>Tool completed</strong><div class="small muted mono">apply_patch · 2 paths affected</div></div></div>
            <div class="event"><span class="small muted">10:43:51</span><span class="line"></span><div><strong>Checkpoint saved</strong><div class="small muted">Operation outcomes durable</div></div></div>
            <div class="event"><span class="small muted">10:43:04</span><span class="line"></span><div><strong>Agent selected</strong><div class="small muted">Database Agent · capability match</div></div></div>
          </section>
          <section class="card">
            <div class="spread"><h2>Queue</h2><button>Reorder</button></div>
            <div class="subtask"><strong>Polish onboarding</strong><div class="small muted">Ready · next</div></div>
            <div class="subtask"><strong>Add workspace export</strong><div class="small muted">Blocked by TASK-024</div></div>
          </section>
        </div>
        <aside class="chat-dock card">
          <div class="spread"><strong>Chat remains available</strong>${badge("Read-only", "amber")}</div>
          <p class="small muted">Architecture Agent · Workbench navigation</p>
          <div class="notice blue small">Reason about the Task while it runs. Repository mutation is disabled.</div>
          <button style="margin-top:10px">Open Chat</button>
        </aside>`;
}

function bChats() {
  return `<div class="area-head spread">
      <div><h1>Chats</h1><p class="muted">Repository conversations, forks, and resumable context.</p></div>
      <button class="primary">＋ New chat</button>
    </div>
    <div class="b-split">
      <section class="card area-list">
        <div class="row"><input class="grow" aria-label="Search chats" placeholder="Search chats" /><button>Filter</button></div>
        <h3>Pinned</h3>
        <button class="area-row selected"><span class="area-icon">◌</span><span><strong>Workbench navigation</strong><small>Architecture Agent · active now</small></span>${badge("Read-only", "amber")}</button>
        <button class="area-row"><span class="area-icon">└</span><span><strong>Storage design</strong><small>Fork · Database Agent · 18 min ago</small></span></button>
        <h3>Recent</h3>
        <button class="area-row"><span class="area-icon">◌</span><span><strong>MCP tool policy</strong><small>Security Agent · yesterday</small></span></button>
        <button class="area-row"><span class="area-icon">◌</span><span><strong>Onboarding notes</strong><small>Docs Agent · Jul 20</small></span></button>
        <div class="divider"></div>
        <button class="area-row" data-action="trash"><span class="area-icon">♲</span><span><strong>Trash</strong><small>2 recoverable sessions</small></span></button>
      </section>
      <section class="stack">
        <div class="card">
          <div class="spread">
            <div><h2>Workbench navigation</h2><span class="muted">Architecture Agent · Claude Sonnet 4.5</span></div>
            <div class="row"><button>Fork</button><button>Open in editor</button><button>⋯</button></div>
          </div>
          <div class="lineage-strip"><span>Extension architecture</span><strong>→</strong><span>Workbench navigation</span><strong>→</strong><span>Storage design</span></div>
        </div>
        <div class="card conversation-preview">${chatMessages()}</div>
        <div class="card">
          <div class="spread"><div>${badge("Read-only", "amber")} <span class="muted">Task owns the repository lock</span></div><button>Continue chat</button></div>
        </div>
      </section>
    </div>`;
}

function bActivity() {
  return `<div class="area-head spread">
      <div><h1>Activity</h1><p class="muted">A human-scale history of outcomes, interventions, and important changes.</p></div>
      <div class="row"><select><option>All work</option><option>Task only</option><option>Chat only</option></select><button>Export</button></div>
    </div>
    <div class="activity-layout">
      <section class="stack">
        <div class="notice blue"><strong>Activity is summarized by default.</strong> Expand an item when you need its Tool and resource provenance.</div>
        <h3>Today</h3>
        <article class="activity-item">
          <span class="activity-mark green">✓</span><div><div class="spread"><strong>Subtask completed · Map persistence API</strong><time>10:44</time></div><p class="muted">Database Agent produced 3 artifacts and satisfied 2 Task Contract criteria.</p><button class="ghost">Show details and Tool records</button></div>
        </article>
        <article class="activity-item important">
          <span class="activity-mark amber">!</span><div><div class="spread"><strong>Repository drift requires review</strong><time>10:41</time></div><p class="muted">A Chat edit overlaps the Task's prior baseline. Reactivation is paused.</p><div class="row"><button>Review changes</button><button>Open Task</button></div></div>
        </article>
        <article class="activity-item">
          <span class="activity-mark blue">↗</span><div><div class="spread"><strong>Conversation fork created · Storage design</strong><time>10:19</time></div><p class="muted">Forked from “Workbench navigation” at turn 18 and handed off to Database Agent.</p></div>
        </article>
        <h3>Yesterday</h3>
        <article class="activity-item">
          <span class="activity-mark">◇</span><div><div class="spread"><strong>Project Memory promoted</strong><time>16:22</time></div><p class="muted">“Session storage architecture” was confirmed from a Chat ledger entry.</p></div>
        </article>
      </section>
      <aside class="card stack">
        <h2>At a glance</h2>
        <div class="metric"><strong>24</strong><span>Agent attempts</span></div>
        <div class="metric"><strong>3</strong><span>Human interventions</span></div>
        <div class="metric"><strong>0</strong><span>Unknown outcomes</span></div>
        <div class="divider"></div>
        <h3>Show in feed</h3>
        <label class="check-row"><input type="checkbox" checked /> Outcomes</label>
        <label class="check-row"><input type="checkbox" checked /> Warnings</label>
        <label class="check-row"><input type="checkbox" /> Routine Tool calls</label>
      </aside>
    </div>`;
}

function bAgents() {
  return `<div class="area-head spread">
      <div><h1>Agents</h1><p class="muted">Who can work here, what they can use, and whether they are eligible now.</p></div>
      <button class="primary">＋ Create repository agent</button>
    </div>
    <div class="b-split agents-split">
      <section class="card area-list">
        <div class="row"><input class="grow" aria-label="Search agents" placeholder="Search agents" /><button>Filter</button></div>
        <h3>Repository agents</h3>
        <button class="area-row selected"><span class="avatar">AR</span><span><strong>Architecture Agent</strong><small>architecture.agent.md</small></span>${badge("Eligible", "green")}</button>
        <button class="area-row"><span class="avatar">DB</span><span><strong>Database Agent</strong><small>database.agent.md</small></span>${badge("Running", "blue")}</button>
        <button class="area-row"><span class="avatar">SE</span><span><strong>Security Agent</strong><small>security.agent.md</small></span>${badge("Eligible", "green")}</button>
        <h3>Bundled agents</h3>
        <button class="area-row"><span class="avatar">OR</span><span><strong>Orchestrator</strong><small>Repository override active</small></span></button>
        <button class="area-row"><span class="avatar">MM</span><span><strong>Memory Manager</strong><small>Protected bundled identity</small></span></button>
      </section>
      <section class="stack">
        <div class="card">
          <div class="spread"><div><h2>Architecture Agent</h2><span class="mono muted">architecture.agent.md</span></div>${badge("Eligible", "green")}</div>
          <p>Designs runtime boundaries, persistence models, and recovery behavior for the current repository.</p>
          <div class="chip-row"><span class="badge">architecture</span><span class="badge">state machines</span><span class="badge">review</span></div>
          <div class="row" style="margin-top:12px"><button>Open definition</button><button>Edit</button><button>Start chat</button></div>
        </div>
        <div class="resource-grid">
          <div class="card"><h3>Model preference</h3><strong>Workbench Auto</strong><p class="small muted">Effective model recorded per attempt.</p></div>
          <div class="card"><h3>Skills</h3><strong>4 available</strong><p class="small muted">Loaded progressively when relevant.</p></div>
          <div class="card"><h3>Tools</h3><strong>8 allowed</strong><p class="small muted">5 repository-confined · 3 ambient.</p></div>
          <div class="card"><h3>MCP servers</h3><strong>1 trusted</strong><p class="small muted">Trust and Tool authority are separate.</p></div>
        </div>
        <div class="notice"><strong>Current limitation</strong><br/>Repository mutation is unavailable in Chat while TASK-024 owns the write lock.</div>
      </section>
    </div>`;
}

function bMemory() {
  return `<div class="area-head spread">
      <div><h1>Memory</h1><p class="muted">Confirmed cross-session knowledge, kept separate from Chat ledgers.</p></div>
      <button class="primary" data-action="promote">＋ Promote from ledger</button>
    </div>
    <div class="memory-toolbar">
      <div class="segmented"><button class="active">Project <span class="count">8</span></button><button>Personal <span class="count">3</span></button></div>
      <input class="grow" aria-label="Search memory" placeholder="Search titles, descriptions, or tags" />
      <button>Filter</button>
    </div>
    <div class="memory-layout">
      <section class="memory-grid">
        <article class="card memory-card selected">
          <div class="spread"><span class="badge">architecture</span><button class="ghost">⋯</button></div>
          <h2>Session storage architecture</h2>
          <p class="muted">Use when changing durable Chat persistence or recovery.</p>
          <div class="small faint">Updated Jul 24 · used by 6 attempts</div>
        </article>
        <article class="card memory-card">
          <div class="spread"><span class="badge">product</span><button class="ghost">⋯</button></div>
          <h2>Workbench MVP boundaries</h2>
          <p class="muted">Use when evaluating scope changes to the first release.</p>
          <div class="small faint">Updated Jul 21 · used by 14 attempts</div>
        </article>
        <article class="card memory-card">
          <div class="spread"><span class="badge">security</span><button class="ghost">⋯</button></div>
          <h2>Ambient Tool authority</h2>
          <p class="muted">Use when an Agent requests effects outside repository-confined Tools.</p>
          <div class="small faint">Updated Jul 20 · used by 9 attempts</div>
        </article>
      </section>
      <aside class="card stack">
        <div class="spread"><h2>Session storage architecture</h2><button>Edit</button></div>
        <div><h3>Retrieval description</h3><p>Use when changing durable Chat persistence or recovery.</p></div>
        <div><h3>Content</h3><p class="muted">The Workbench stores session state in extension-owned, workspace-scoped SQLite storage.</p></div>
        <div><h3>Provenance</h3><p class="small muted">Promoted from “Workbench navigation” ledger entry · confirmed by you · Jul 24</p></div>
        <div><h3>Recent use</h3><button class="ghost">Response attempt 9f31 · Architecture Agent ↗</button></div>
      </aside>
    </div>`;
}

function bSettings() {
  return `<div class="area-head">
      <h1>Settings</h1><p class="muted">Workbench behavior for this repository. Agent, Skill, Memory, and MCP files remain in their native locations.</p>
    </div>
    <div class="settings-layout">
      <nav class="card settings-nav">
        <button class="active">General</button><button>Chat</button><button>Tasks</button><button>Models</button><button>Tools & authority</button><button>Storage</button>
      </nav>
      <section class="stack">
        <div class="card settings-section">
          <h2>General</h2>
          <div class="setting-row"><div><strong>Default landing area</strong><p>Choose what opens when you enter the Workbench.</p></div><select><option>Tasks</option><option>Chats</option></select></div>
          <div class="setting-row"><div><strong>Desktop notifications</strong><p>Notify for completion and required intervention.</p></div><select><option>Important only</option><option>All activity</option><option>Off</option></select></div>
        </div>
        <div class="card settings-section">
          <h2>Repository</h2>
          <div class="setting-row"><div><strong>Primary root</strong><p class="mono">bridgit-ui/</p></div>${badge("Trusted", "green")}</div>
          <div class="setting-row"><div><strong>Approved linked roots</strong><p>No linked roots are approved.</p></div><button>Manage</button></div>
        </div>
        <div class="card settings-section">
          <h2>Private storage</h2>
          <div class="setting-row"><div><strong>Workspace data</strong><p>Chat history, Task records, ledgers, summaries, and private artifacts.</p></div><span class="muted">184 MB</span></div>
          <div class="row"><button>Open storage diagnostics</button><button class="danger">Reset Workbench data…</button></div>
        </div>
        <div class="notice blue"><strong>Project configuration stays reviewable.</strong> Repository Agents and Skills live under <span class="mono">.github/</span>; MCP configuration uses <span class="mono">.vscode/mcp.json</span>.</div>
      </section>
    </div>`;
}

function variantBSidebar() {
  return `<div class="app-shell vscode-preview">
    <aside class="vscode-activity" aria-label="VS Code activity bar">
      <span>▱</span><span>⌕</span><span>⑂</span><span>▷</span><span class="active">◆</span>
      <span class="grow"></span><span>◎</span><span>⚙</span>
    </aside>
    <aside class="workbench-sidebar">
      <div class="sidebar-title">BRIDGIT</div>
      <div class="sidebar-launcher">
        <div class="sidebar-mark">◆</div>
        <h1>Agent Workbench</h1>
        <p>Chats, autonomous Tasks, Agents, and Memory live together in a full editor view.</p>
        <button class="primary open-workbench" data-action="open-workbench">Open Workbench in Editor</button>
        <div class="sidebar-status">
          ${badge("Task running", "green")}
          <strong>Implement durable session storage</strong>
          <span class="small muted">7 of 12 subtasks complete</span>
        </div>
      </div>
    </aside>
    <main class="vscode-editor-placeholder">
      <div class="editor-tabs"><span class="active">Welcome</span></div>
      <div class="empty-editor">
        <strong>bridgit-ui</strong>
        <span class="muted">The Workbench opens here as a full editor tab.</span>
      </div>
    </main>
  </div>`;
}

function variantB() {
  const areas = [["task","Tasks"],["chat","Chats"],["history","Activity"],["agents","Agents"],["memory","Memory"],["settings","Settings"]];
  const contents = { Tasks: bTasks, Chats: bChats, Activity: bActivity, Agents: bAgents, Memory: bMemory, Settings: bSettings };
  const title = state.bArea === "Tasks" ? "Task command center" : state.bArea;
  return `<div class="app-shell">
    ${titlebar(title)}
    <main class="b-grid">
      <nav class="b-rail" aria-label="Workbench areas">
        ${areas.map(([i,n]) =>
          `<button class="rail-button ${state.bArea === n ? "active" : ""}" data-b-area="${n}" aria-current="${state.bArea === n ? "page" : "false"}"><span>${icon(i)}</span>${n}</button>`).join("")}
      </nav>
      <section class="b-main">
        ${contents[state.bArea]()}
      </section>
    </main>
  </div>`;
}

function variantC() {
  const chatActive = state.mode === "Chat";
  return `<div class="app-shell">
    ${titlebar("Context navigator")}
    <main class="c-grid">
      <aside class="c-context">
        <div class="pane-head spread"><strong>Context</strong><button>＋</button></div>
        <div class="lineage">
          <h3>Conversation lineage</h3>
          <div class="tree-row"><span>◌</span><div>Extension architecture<div class="small faint">Origin · 42 turns</div></div></div>
          <div class="tree-row indent active"><span>└</span><div>Workbench navigation<div class="small muted">Current · Architecture Agent</div></div></div>
          <div class="tree-row indent"><span>└</span><div>Storage design<div class="small faint">Fork · Database Agent</div></div></div>
          <div class="tree-row indent"><span>└</span><div><span class="faint">Deleted origin</span><div class="small faint">Surviving fork · 8 turns</div></div></div>
        </div>
        <div class="divider"></div>
        <div class="lineage">
          <div class="spread"><h3>Session context</h3><button class="ghost">Inspect all</button></div>
          <div class="card stack">
            <div class="spread"><span>Summary</span>${badge("v3 active", "blue")}</div>
            <div class="spread"><span>Ledger</span><span class="muted">12 active · 1 disputed</span></div>
            <div class="spread"><span>Memories used</span><span class="muted">3 versions</span></div>
            <button data-action="promote">Promote ledger entry…</button>
          </div>
        </div>
        <div class="lineage"><button class="danger" data-action="trash">Move session to Trash…</button></div>
      </aside>
      <section class="c-canvas">
        <div class="mode-tabs">
          <button class="${chatActive ? "active" : ""}" data-mode="Chat">Chat</button>
          <button class="${!chatActive ? "active" : ""}" data-mode="Task">Active Task ${badge("Running", "green")}</button>
          <span class="grow"></span>
          <button>Tools <span class="count">7</span></button><button>Ledger <span class="count">12</span></button>
        </div>
        <div class="canvas-inner">
          ${chatActive ? `<div class="focus-grid">
            <section class="card conversation">
              <div class="spread"><div><h1>Workbench navigation</h1><div class="muted">Architecture Agent · Claude Sonnet 4.5</div></div><button>Fork from here</button></div>
              <div class="divider"></div>${chatMessages()}
            </section>
            <aside class="stack">
              ${taskSummary(false)}
              <div class="notice blue small"><strong>Chat is read-only</strong><br/>The active Task owns the repository lock. Tool availability is checked at invocation.</div>
              <div class="card"><h3>Current context</h3><div class="spread"><span>Summary</span><button class="ghost">v3 ↗</button></div><div class="spread"><span>Ledger</span><button class="ghost">12 entries ↗</button></div></div>
            </aside>
          </div>` : `<div class="focus-grid">
            <section class="card">
              <div class="spread"><div><h1>Implement durable session storage</h1><div class="muted">Active Task Contract · revision 4</div></div>${taskControls()}</div>
              <div class="divider"></div>
              <h3>Execution narrative</h3>
              <div class="trace-step"><strong>Update session store</strong><div class="small muted">Running · Database Agent · checkpoint 18</div></div>
              <div class="trace-step"><strong>Repository drift observed</strong><div class="small muted">Baseline comparison requires review before reactivation</div></div>
              <div class="trace-step"><strong>Run integration suite</strong><div class="small muted">Waiting on “Update session store”</div></div>
              <div style="margin-top:12px">${driftNotice()}</div>
            </section>
            <aside class="stack">
              <div class="card"><h3>Contract health</h3><div class="spread"><span>Success criteria</span><span>5 / 8</span></div><div class="spread"><span>Authority</span>${badge("Bounded", "green")}</div><div class="spread"><span>Unknown outcomes</span><span>0</span></div></div>
              <div class="card"><h3>Queue</h3><p>Polish onboarding</p><p class="muted">Add workspace export · dependency blocked</p></div>
            </aside>
          </div>`}
        </div>
      </section>
    </main>
  </div>`;
}

function dialogs() {
  return `<dialog id="memory-dialog">
      <div class="dialog-head"><strong>Preview Memory Promotion</strong><div class="small muted">Nothing is written until you confirm.</div></div>
      <div class="dialog-body stack">
        <label>Scope<select><option>Project Memory</option><option>Personal Memory</option><option>Session only — cancel promotion</option></select></label>
        <label>Title<input value="Session storage architecture" /></label>
        <label>Retrieval description<input value="Use when changing durable Chat persistence" /></label>
        <label>Content<textarea rows="4">The Workbench stores session state in extension-owned, workspace-scoped SQLite storage.</textarea></label>
        <label>Tags<input value="storage, chat, architecture" /></label>
      </div>
      <div class="dialog-actions"><button data-close>Cancel</button><button class="primary" data-close>Confirm promotion</button></div>
    </dialog>
    <dialog id="trash-dialog">
      <div class="dialog-head"><strong>Move “Workbench navigation” to Trash?</strong></div>
      <div class="dialog-body">
        <p>The session can be restored. Its Conversation Forks remain available and may show a deleted-origin marker.</p>
        <div class="notice red small"><strong>Permanent deletion later does not undo:</strong> repository changes, promoted Memories, or surviving forks. It removes transcript, summaries, ledger, Response and Tool records, and private artifacts.</div>
      </div>
      <div class="dialog-actions"><button data-close>Cancel</button><button class="danger" data-close>Move to Trash</button></div>
    </dialog>`;
}

function switcher(current) {
  return `<nav class="switcher" aria-label="Prototype variants">
    <span class="proto">PROTOTYPE</span>
    <button data-cycle="-1" aria-label="Previous variant">←</button>
    <strong>${current} — ${variants[current]}</strong>
    <button data-cycle="1" aria-label="Next variant">→</button>
  </nav>`;
}

function currentVariant() {
  const key = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[key] ? key : "A";
}

function render() {
  const current = currentVariant();
  const sidebarSurface = current === "B" && new URLSearchParams(location.search).get("surface") === "sidebar";
  document.querySelector("#app").innerHTML =
    (sidebarSurface ? variantBSidebar() : current === "A" ? variantA() : current === "B" ? variantB() : variantC()) +
    dialogs() + switcher(current);
  bind();
}

function cycle(direction) {
  const keys = Object.keys(variants);
  const next = keys[(keys.indexOf(currentVariant()) + direction + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", next);
  history.replaceState({}, "", url);
  render();
}

function bind() {
  document.querySelectorAll("[data-cycle]").forEach(button =>
    button.addEventListener("click", () => cycle(Number(button.dataset.cycle))));
  document.querySelectorAll("[data-inspector]").forEach(button =>
    button.addEventListener("click", () => { state.activeInspector = button.dataset.inspector; render(); }));
  document.querySelectorAll("[data-mode]").forEach(button =>
    button.addEventListener("click", () => { state.mode = button.dataset.mode; render(); }));
  document.querySelectorAll("[data-b-area]").forEach(button =>
    button.addEventListener("click", () => { state.bArea = button.dataset.bArea; render(); }));
  document.querySelectorAll("[data-action='pause']").forEach(button =>
    button.addEventListener("click", () => { state.taskStatus = state.taskStatus === "running" ? "quiescing" : "running"; render(); }));
  document.querySelectorAll("[data-action='stop']").forEach(button =>
    button.addEventListener("click", () => alert("Prototype: Stop would quiesce safely, preserve completed edits, then cancel.")));
  document.querySelectorAll("[data-action='correct-ledger']").forEach(button =>
    button.addEventListener("click", () => { state.corrected = true; render(); }));
  document.querySelectorAll("[data-action='promote']").forEach(button =>
    button.addEventListener("click", () => document.querySelector("#memory-dialog").showModal()));
  document.querySelectorAll("[data-action='trash']").forEach(button =>
    button.addEventListener("click", () => document.querySelector("#trash-dialog").showModal()));
  document.querySelectorAll("[data-action='open-workbench']").forEach(button =>
    button.addEventListener("click", () => {
      const url = new URL(location.href);
      url.searchParams.delete("surface");
      history.replaceState({}, "", url);
      state.bArea = "Tasks";
      render();
    }));
  document.querySelectorAll("[data-close]").forEach(button =>
    button.addEventListener("click", () => button.closest("dialog").close()));
}

addEventListener("popstate", render);
addEventListener("keydown", event => {
  const target = event.target;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
  if (event.key === "ArrowLeft") cycle(-1);
  if (event.key === "ArrowRight") cycle(1);
});

render();
