# Local Wayfinder tracker

This workspace has no configured external issue tracker, so Wayfinder issues live in
`.wayfinder/issues/`.

## Wayfinding operations

- Each issue is one Markdown file with YAML metadata.
- `id` is the local issue identity; prose refers to an issue by its linked `title`.
- A map has `type: map`; a decision ticket has `type: research`, `prototype`,
  `grilling`, or `task`.
- `parent` identifies the map issue.
- `blocked_by` lists ticket IDs whose status must be `closed` before the ticket is
  on the frontier.
- An open ticket with no unresolved blockers and no `assignee` is frontier work.
- Claim a ticket by setting `assignee` before beginning work.
- Resolve a ticket by adding a `## Resolution` section, setting `status: closed`,
  and adding its linked one-line gist to the map's `## Decisions so far`.

