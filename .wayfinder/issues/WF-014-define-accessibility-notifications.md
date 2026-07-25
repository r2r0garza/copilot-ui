---
id: WF-014
title: Define the Workbench accessibility and notification contract
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-010
---

## Question

For the chosen single-action VS Code sidebar and full-editor Task-command-center
Workbench, what keyboard navigation, focus-transfer, screen-reader semantics,
live-region behavior, reduced-motion behavior, non-color status cues, focus
restoration, and destructive-action confirmation rules are required? Which Task,
Chat, recovery, routing, permission, and completion events appear only inside
the Workbench, create VS Code badges, raise in-app notices, or trigger desktop
notifications, and how are duplicate or noisy notifications suppressed?

## Resolution

Adopt a WCAG 2.2 AA, document-oriented accessibility contract for the full-editor
Workbench and a quiet, identity-based attention model for events outside it.

### Keyboard, semantics, and focus

- Use native HTML landmarks, headings, buttons, links, lists, forms, and dialogs
  wherever possible. The six-area rail is navigation; the selected area is the
  single main region and has one primary heading. Provide a skip link to it.
- Model each dense collection as one composite keyboard stop. `Tab` and
  `Shift+Tab` move among regions and controls; arrow keys move within a
  collection; `Home` and `End` move to its bounds; `Enter` or `Space` activates;
  `Escape` closes transient UI and restores its invoking focus. Only the active
  collection item participates in the tab order.
- Present the Task board as named sections containing linear Subtask lists, not
  an ARIA grid or drag-only Kanban. Present Chat as a navigable transcript, not
  a live log, with commands to jump to the composer and latest response. Never
  use `role="application"` or replace standard screen-reader browsing keys.
- Background work never opens the Workbench or transfers focus. First open from
  the sidebar focuses the selected area's heading, normally Tasks. Reopening an
  existing tab restores its last meaningful focus when that control still
  exists, otherwise its area heading. Area changes focus the destination
  heading. Activating an Attention Request focuses its referenced notice or
  event summary. Dialog close returns focus to its invoker or the nearest
  surviving parent.
- Register configurable Command Palette commands for opening the Workbench,
  focusing its navigation, focusing the active Attention Request, focusing the
  Chat composer or latest response, pausing a Task, and cancelling a Task.
  Assign no default global shortcuts.

### Announcements, motion, and visual state

- Use one centralized polite live region for concise, coalesced announcements of
  meaningful state changes: pause, intervention, permission availability,
  recovery completion, and terminal Task outcomes. Do not announce streaming
  content, routine Subtask or Tool activity, timers, or duplicate state updates.
  Use no assertive live region; execution quiesces safely instead of depending
  on an immediate human response. User-invoked confirmations use dialog
  semantics and descriptive text.
- Honor VS Code's `vscode-reduce-motion` body class by removing spinners, pulses,
  sliding transitions, smooth scrolling, and other nonessential animation.
  Apply state changes immediately and replace motion-based progress with static
  icons plus explicit text.
- Every Task, Chat, Subtask, Agent, permission, recovery, and Memory state has a
  visible text label and accessible name. Icons may reinforce it and color is
  tertiary. Counts and chart meaning are available as text; tooltips never carry
  the only explanation. Use VS Code theme tokens and preserve distinctions in
  high-contrast themes.

### Destructive actions and permission decisions

- Pause, deny, dismiss, and remove queued drafts immediately without
  confirmation. Use an Undo path for recoverable actions such as trashing a
  Chat Session.
- Cancelling an active Task requires one confirmation explaining that the Task
  becomes terminal and completed repository changes remain.
- Permanent Chat deletion, repository-resource deletion, and Workbench-data
  reset use strong confirmations that name what disappears, what survives, and
  whether recovery is possible; initial focus lands on the safe action. Only a
  full Workbench-data reset requires typed confirmation, using the repository
  name.
- Chat Ambient Tool requests appear as persistent inline approval cards beside
  the requesting turn, with bounded Approve once, eligible Approve for this Chat
  Session, and Deny actions. Hidden requests become Attention Requests. Task
  Authority Review is a blocking pre-admission Workbench review whose safe
  choice receives initial focus; an executing Task never opens an authority
  prompt. Memory changes continue through their exact Memory Change Proposal.

### Event surfaces

The Activity area remains the durable human-readable history. Routine Tool and
resource provenance stays collapsed. Additional surfaces follow this matrix:

| Event class | Workbench presentation | Attention Badge | VS Code notification |
| --- | --- | --- | --- |
| Routine Task, Subtask, Tool, queue, retry, automatic routing, or automatic recovery progress | Inline status or collapsed Activity only | No | No |
| Chat streaming or completion | Transcript only | No | No |
| Chat permission request when its Chat is visible | Persistent inline approval card and polite announcement | No | No |
| Routing intervention, hidden Chat permission request, repository conflict, unknown operation outcome, failed recovery, or other user action required | Persistent Workbench Notice until resolved | Yes, while unresolved | Yes when configured and not already visible |
| Task paused or ordinary recovery completed | Updated state, Activity, and polite announcement; recovery may show an acknowledgeable outcome notice | No | No |
| Task completed, failed, or cancelled | Activity plus acknowledgeable outcome notice | No | Yes under Important only when not already visible |
| Memory Promotion suggestion or nonblocking limitation | Contextual inline message | No | No |

The sidebar's public view badge is an **Attention Badge**: it counts unresolved
Attention Requests, not unread events, running work, or completed Tasks. Viewing
a request does not clear it.

Rename the prototype's **Desktop notifications** setting to **VS Code
notifications**. Do not invoke platform-specific operating-system notification
utilities; any desktop delivery by VS Code or the operating system is outside
the extension contract. The setting has:

- **Important only** (default): unresolved Attention Requests and terminal Task
  outcomes.
- **Action required only**: unresolved Attention Requests.
- **Off**: no VS Code notifications; Workbench Notices and the Attention Badge
  remain.

Suppress a VS Code notification whenever the corresponding Workbench Notice is
already visible in the focused window.

Every Attention Request and terminal Task outcome has a durable identity and
version. Notify at most once per version; do not replay notifications after
extension restart or Workbench reopen, and never nag periodically. Update an
existing Workbench Notice for refinements of the same version. Coalesce multiple
events from one Task within 30 seconds into one summary notification. A
materially new state may create a new version and notify again. Opening a
notification marks an outcome seen but neither resolves an Attention Request nor
reduces its badge count.

### Acceptance baseline

- WCAG 2.2 AA applies to the custom Workbench webview.
- All core Task, Chat, permission, recovery, and destructive-action flows work
  keyboard-only with visible focus and no traps.
- Automated accessibility checks have no serious or critical violations.
- Manual NVDA/Windows coverage exercises every core flow. VoiceOver/macOS and
  Orca/Linux smoke tests cover opening, navigation, notices, dialogs, and Chat.
- Light, dark, high-contrast, 200% zoom, and reduced-motion modes are verified.
- Automated interaction tests assert focus restoration and live-region
  behavior.
