# Workflow / Goal / Deep Research progress (P2-10)

Design + wire notes for progress cards on the live `_x.ai/session_notification`
rail. Engines stay in the CLI; the extension only renders cards and optional
pause/resume/stop by display name.

## Slash surface (leave alone)

Advertised by the CLI and **not** in `HIDDEN_SLASH_COMMANDS`:

| Command | Role |
|---|---|
| `/deep-research <query>` | Launch a background research workflow |
| `/workflow …` | Launch / `pause` / `resume` / `stop` / `save` by display name |
| `/goal …` | Set / `status` / `pause` / `resume` / `clear` an autonomous goal |
| `/workflows` | TUI run dashboard (no ACP equivalent — cards replace the need) |

## Live rail kinds

From CLI binary symbols (0.2.111) + session_notification family:

| `sessionUpdate` | Meaning |
|---|---|
| `workflow_updated` | Rollup for a background run (phase, agents, last_event, …) |
| `goal_updated` | Rollup for `/goal` (deliverables, phase, …) |
| `workflow_started` / `_paused` / `_resumed` / `_completed` / `_failed` / `_cancelled` | Lifecycle siblings (parsed when present) |
| `goal_created` / `_paused` / `_resumed` / `_completed` / `_cleared` | Goal lifecycle siblings |

### Typical `workflow_updated` fields (snake_case)

`run_id`, `display_name` / `name`, `objective`, `current_phase` / `phase`,
`agent_budget`, `agents_used`, `current_agent_label`, `last_event`,
`last_event_detail`, `pause_message`, `result_summary`, …

### Typical `goal_updated` fields

`goal_id`, `objective`, `phase`, `total_deliverables`, `completed_deliverables`,
`current_deliverable_title`, `token_budget`, …

## Extension mapping

| Layer | Role |
|---|---|
| `src/run-progress.ts` | Pure `isRunProgressUpdate` / `parseRunProgressUpdate` / `workflowControlCommand` |
| `sidebar.ts` xaiNotification | Emit `{ type: "runProgress", update }` |
| `media/chat.js` | Upsert teal progress cards; Pause/Resume/Stop → `workflowControl` → `/workflow …` |

Cards are buffered on the session like subagent rows, so a warm re-focus
replays them. `readWorkflowCompletion` reconciles unfinished buffered runs with
`~/.grok/sessions/<encoded cwd>/<session id>/workflows/<run id>/state.json`
on notification ingestion, before replay, and every two seconds for pooled
sessions, including sessions without a viewer. Only an explicit terminal run
status repairs a notification; missing, unreadable or incomplete files retry.
Workflow agent rows disclose activity only when there is detail to show.
Rows with a positive snapshot token total and no observed activity have no
button or chevron. Expansion is held in memory per run, with every new run
collapsed; it is never a host setting.

A live transcript entry is a non-expandable name/status marker. The pinned card
shows static dots from the reported phases, current phase, reported elapsed time,
and `updated Ns ago` from frame arrival. Its expanded view adds labelled phases,
agent budget and single-line agent summaries. Pause/Resume and Stop stay outside
the disclosure. A finished run (`complete` or `completed`, including a Partial
result summary) leaves the pin and replaces its marker with an expandable
summary that arrives collapsed, without Pause/Stop. Stateless phase definitions
remain unknown during a live run except for its current position; successful
completion marks them done. The retained current phase cannot mark a terminal run's step active;
failed/cancelled runs preserve pending steps instead of claiming they finished.

This summary renders notification metadata, not the contents of a report file.
Workflow definitions and artifact generation live in the CLI, not this repo.
Assistant prose arrives independently through `messageChunk`, and file reads
through tool calls; neither is required for the workflow card to finish.

Receipt arrival, token increases and reported state transitions remain separate
facts. Duplicate frames refresh only receipt age. Zero tokens do not establish
activity, and even a state transition retains the absence of observed token
activity in agent detail. Missing fields hide their dependent affordances.
Counts use thousands separators; names and control handles never use run ids.

## Probes

A dedicated live capture (launch `/deep-research` and dump `workflow_updated`
payloads) can be added under `research/run-progress-probe.cjs` when credit budget
allows; unit tests pin the pure parsers against synthetic shapes derived from
binary field names + user-guide semantics.

## Reload and older hosts

The relay forwards the host snapshot; it does not read the CLI workflow store.
`GrokSidebar.emit` buffers normalized `runProgress` messages.
`buildRemoteSnapshot` / `sendRemoteHistorySnapshot` bracket that buffer in
`historyReplay`; a full host restart first obtains history via ACP
`session/load`. Replaying a stale active notification does not consult
`state.json` unless the host reconciles it. The client receipt then correctly
says "no update since this view opened", but the run status can be stale.

A repaired update uses the existing `runProgress` message, `done: true`, and
`phase: "completed"` for CLI `complete`. The v2.0.4 renderer already maps
`completed` to done and removes controls using `done`; no new wire value is
introduced. The newer client also recognizes explicit terminal phase values
from hosts that incorrectly set `done: false`. It cannot establish completion
from an old host's active-only snapshot, silence, or all-done agents between
stages. Missing terminal evidence therefore needs the host repair deployed.

The two-stage fixture records the supplied state shape and identifies its
synthetic second-run fields. Regression stale notifications are constructed,
not claimed as a capture. Direct access to the affected Sprite was denied
(EACCES) during this repair, so the exact last notification in its store has
not been independently read.
