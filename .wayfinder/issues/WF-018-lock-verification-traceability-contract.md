---
id: WF-018
title: Lock the MVP verification and specification traceability contract
type: grilling
label: wayfinder:grilling
status: closed
parent: WF-001
assignee: codex
blocked_by:
  - WF-011
  - WF-016
  - WF-017
---

## Question

Which unit, contract, integration, scenario, accessibility, recovery, security,
and VS Code end-to-end checks—and which traceability and evidence rules—must
pass before the MVP specification is accepted as implementation-ready?

## Resolution

### Two acceptance gates

The MVP has two distinct evidence gates:

1. The **Specification Acceptance Gate** determines whether the specification is
   complete, consistent, traceable, and precise enough for implementation to
   begin without reopening product or architecture decisions. It validates the
   specification and its executable test design; it does not claim that an
   unbuilt implementation has passed its prescribed checks.
2. The **Implementation Verification Gate** later determines whether the built,
   packaged Workbench satisfies the accepted specification.

Both gates are strict. Every mandatory check must resolve to `pass`. A failure,
skip, quarantine, flaky-only pass, missing evidence, unsupported
`not-applicable` claim, or inconclusive result blocks the applicable gate.
Infrastructure failures may be rerun, but the retained run must be clean and
reproducible. Mandatory MVP checks have no waiver path.

### Normative requirements and bidirectional traceability

Every atomic, testable obligation in the specification is a **Normative
Requirement** with a stable ID. Rationale, examples, and explanatory prose are
not requirements and remain unnumbered.

The canonical traceability model is bidirectional:

```text
Normative Requirement
  ↔ owning component and invariant
  ↔ mandatory Verification Check
  ↔ required evidence
```

Every requirement links to at least one Verification Check, and every check
links back to one or more requirements. The fourteen Acceptance Scenarios are
grouped user and recovery journeys; they do not replace atomic requirement
traceability.

Each named Verification Check declares:

- verification layer and stable check identity;
- requirement and Threat Case links;
- applicable Supported Targets and profiles;
- setup and synthetic fixtures;
- stimulus, observable oracle, and prohibited outcomes;
- failure and cleanup behavior; and
- required machine or human evidence.

The specification prescribes these mandatory observable guarantees without
dictating every internal unit test or the implementation's complete test
layout.

### Specification Acceptance Gate

The gate requires both structural automation and semantic human judgment.

A machine-checkable requirements and verification manifest must prove:

- unique, stable requirement and check identities;
- valid bidirectional links with no orphan requirement, invariant, Threat Case,
  check, or evidence obligation;
- all mandatory check fields and target applicability are present;
- lifecycle states, transitions, protocol messages, schema elements, security
  controls, and acceptance scenarios referenced by requirements exist;
- every Durability Boundary generates a fault-injection check;
- every required control in the threat model has a negative check;
- every Acceptance Scenario is covered by the headless scenario profile;
- the packaged VS Code subset and both Supported Targets are fully represented;
  and
- there are no unresolved placeholders, contradictory normative statements, or
  unowned decisions.

A structured semantic review must establish that requirements are atomic,
unambiguous, internally consistent, and observable; that each oracle actually
proves its requirement; that cross-feature behavior and terminology agree; and
that no unresolved product or architecture choice is concealed inside a test.

One accountable human records acceptance of the exact specification revision.
The acceptor may also be the author; an independent second reviewer is
encouraged but not required. The resulting Specification Acceptance Record
contains the revision, validator result, completed semantic checklist,
zero-unresolved-item result, acceptor, and acceptance time.

### Implementation verification layers

#### Unit and invariant checks

Deterministic unit checks cover parsers, schemas, lifecycle guards, graph rules,
Resource Snapshot rules, authority decisions, Repository Boundary enforcement,
operation reconciliation, Memory conflict and promotion rules, attention
deduplication, diagnostic redaction and retention, compatibility selection, and
migration planning.

Task and Chat state machines, Task Graph Revision, write-lock ownership,
authority monotonicity, operation reconciliation, retention, and migration
compatibility also require deterministic model-based or property checks.
Generative runs record their seed and, on failure, a minimized transition trace.

Requirement and Verification Check coverage must be 100%. A repository-wide
line-percentage target is not a gate. State-transition and guard branches in the
Critical Verification Kernels—lifecycle, authority, Repository Boundary,
protocol validation, redaction, and migration—must be completely exercised and
mutation-tested with no unexplained behavior-changing survivor. Ordinary line
and branch metrics remain visible diagnostics.

#### Contract checks

One reusable contract suite applies to each port's fake and production adapter,
covering successful behavior, malformed input, cancellation, timeouts,
unavailability, partial streams, version mismatch, provider errors,
idempotency or reconciliation metadata, sanitized error mapping, and cleanup.

Required contracts include:

- the versioned Workbench Protocol command, event, validation, reconstruction,
  duplicate-command, mismatched-Webview, and side-effect rejection rules;
- SQLite transaction, migration, integrity, backup, downgrade-refusal, and
  recovery behavior;
- `vscode.lm` model discovery, selection, request, streaming, Tool-call,
  cancellation, disappearance, consent, quota, and error behavior;
- Repository, linked-root, filesystem, and Git operations;
- Workbench, extension-registered, and MCP Tool discovery and invocation;
- SecretStorage references and secret-minimized execution;
- notifications and Attention Request delivery; and
- diagnostic, audit, redaction, and Support Bundle projections.

Real-host model checks install a test-only **Deterministic Model Provider** that
registers predictable models through the real stable `vscode.lm` provider API.
It is excluded from production packages. Live Copilot or other provider smoke
checks are available to developers but are not release-blocking because
consent, quota, network availability, and model output are nondeterministic.

#### Integration checks

Integration checks combine the application layer and Runtime with real SQLite
temporary databases and synthetic temporary repositories and Git histories.
They verify transactional state plus event or audit persistence, resource
discovery isolation, Task and Chat coordination, authority and lock behavior,
operation intents and reconciliation, repository reactivation, diagnostic
causal chains, schema evolution, backup restoration, and restart recovery.

External services, MCP servers, credentials, identities, conversations, and
failure conditions use deterministic Verification Fixtures. No gate depends on
a live external account or real repository data.

#### Headless scenario checks

All fourteen minimum Acceptance Scenarios fixed by
[Lock the MVP architecture and specification acceptance contract](WF-011-lock-spec-architecture.md)
run deterministically through the headless Runtime harness. Their fixtures and
oracles are machine-readable, and each scenario traces to its component
requirements without duplicating domain policy in the test driver.

#### Webview checks

Webview checks cover command emission, authoritative event projection, stale and
duplicate message rejection, restoration from extension-host state, loading and
error states, focus ownership and restoration, keyboard behavior, announcements,
theme behavior, production Content Security Policy, and the rule that the
Webview owns no authoritative domain state.

### Developer and packaged VS Code profiles

The **Developer Verification Profile** provides a fast, focused command for
running selected checks from the current source tree in a real VS Code Extension
Development Host while implementation is in progress. It supports the user's
preference to exercise each evolving workflow in real VS Code. Live-model smoke
checks may be run in this profile.

Milestone builds additionally install and test the actual VSIX. The final
packaged profile runs on both `win32-x64` and `darwin-arm64` under the declared
VS Code `1.130.x` range and covers:

1. installation, lazy activation, Webview restoration, no-workspace refusal,
   and production Webview CSP;
2. resource discovery plus deterministic `vscode.lm` selection, streaming,
   cancellation, Tool calls, and provider failure;
3. Chat creation, send, cancel, fork, reload, and durable Response Attempts;
4. Task admission, execution, Repository Write Lock, pause, abrupt Extension
   Host termination, repository reactivation, recovery, and resume;
5. authority denial, Unknown Operation Outcome, reconciliation, and audit
   evidence;
6. Attention Requests, diagnostics, redaction, and Support Bundle creation;
7. fresh database startup, direct upgrade, interrupted migration, corruption
   recovery, downgrade refusal, backup restoration, uninstall/reinstall, and
   manual VSIX upgrade and downgrade; and
8. the release-blocking keyboard and platform-native accessibility flows.

The exhaustive fourteen-scenario matrix need not be duplicated through the
packaged UI where behavior is already proven headlessly and does not depend on
VS Code assembly.

### Accessibility checks

Accessibility acceptance remains WCAG 2.2 AA and requires:

- automated semantic and rule checks for every major Webview state;
- keyboard-only completion of every core flow in packaged VS Code on both
  Supported Targets;
- manual Narrator evidence on Windows and VoiceOver evidence on macOS for
  representative Chat, Task, intervention, recovery, and diagnostics flows; and
- manual checks for 200% zoom, high-contrast themes, reduced motion, focus
  restoration, and deduplicated announcements.

Platform-native manual results are release-blocking. A clean automated scan
cannot override a failed keyboard or screen-reader flow.

### Recovery checks

The Runtime declares every durable intent, external-effect handoff, commit,
checkpoint, lock transition, and migration step as a Durability Boundary. The
verification manifest generates a deterministic fault-injection case for every
registered boundary.

After each injected failure and restart, an invariant checker must prove one
specified result: safely resumed, reconciled, explicitly blocked, or terminal.
No run may silently duplicate an effect, lose committed state, bypass authority,
retain a stale lock, or retry an Unknown Operation Outcome without
reconciliation.

The exhaustive matrix runs through the headless harness with real SQLite and a
synthetic repository. Representative abrupt-host, operation-handoff, checkpoint,
and migration crashes also run in packaged VS Code on both Supported Targets.

### Security and supply-chain checks

The specification contains a threat model identifying assets, trust boundaries,
attacker capabilities, abuse paths, required controls, and accepted residual
risks. Every control traces to adversarial Verification Checks.

Required negative coverage includes authority bypass, Repository Boundary and
linked-root escape, traversal and symlink attacks, protocol and schema abuse,
message forgery, secret leakage, Agent or MCP resource substitution, unsafe
Tool retry and recovery, audit tampering, SQLite corruption, Support Bundle
redaction failure, Webview CSP violations, and package-content injection.

The packaged gate also requires:

- an exact VSIX-content allowlist and production/development-file separation;
- production dependency and license inventories plus an SBOM;
- secret, credential, absolute-path, and source-artifact scans;
- SHA-256 verification of both VSIXs; and
- vulnerability scanning against the packaged dependency graph.

A known exploitable critical or high-severity vulnerability in shipped code
blocks release. Findings confined to non-shipped development tooling are
recorded and assessed separately.

### Evidence and privacy

All automated gates use synthetic repositories, identities, credential
references, conversations, MCP servers, and external providers. Manual
accessibility sessions use the supplied synthetic fixtures.

Evidence passes the diagnostic redaction contract plus secret, real-content,
absolute-path, username, machine-identity, and repository-identity scanning
before retention or release attachment. Any detected secret, real repository
content, or unsanitized host identity fails the gate.

Every Conclusive Verification Run produces a sanitized, machine-readable
Verification Manifest containing:

- source revision, extension version, package hashes, and build identity;
- Supported Target and VS Code, Electron, Node, database-schema, and Workbench
  Protocol versions;
- check IDs, outcomes, durations, deterministic seeds, and fixture identities;
- bounded supporting-artifact references and checksums;
- coverage and mutation summaries;
- threat, accessibility, recovery, migration, and supply-chain results; and
- required human attestations.

The requirements manifest, successful validator result, and Specification
Acceptance Record are version-controlled with the canonical specification.
Each GitHub Release attaches its Verification Manifest and readable summary
alongside the two VSIXs. Detailed sanitized logs may follow bounded CI
retention; they are supporting diagnostics rather than the durable acceptance
proof.

### Explicit verification boundary

The gate verifies correctness under cancellation, backpressure, bounded queues,
retention limits, long-running streams, and cleanup. It detects leaked locks,
handles, child processes, and unbounded storage growth, and records timing as
diagnostic evidence.

Quantitative latency, CPU, memory, token, cost, and organization-controlled VDI
resource SLOs remain outside this MVP verification contract. They belong to the
deferred Workbench Resource Governance effort.

The clarified domain language is recorded in
[CONTEXT.md](../../CONTEXT.md).
