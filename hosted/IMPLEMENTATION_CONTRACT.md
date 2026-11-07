# Hosted implementation handoff

Base: reviewed P1 checkpoint `34e2395`, ahead of main. This branch depends on that checkpoint. The user authorized finishing development, end-to-end validation and a shipping plan. Production admission defaults to zero; P1 physical allocation, live identity and capacity evidence remain release gates. Implementing later phases does not close those gates.

## Internal storage boundary

`Workspace.invoke(access: Access, operation: string, input: Input = {}): Promise<Result>` is trusted RPC, never a client-selected object endpoint. Access is `{uid,generation}`. The HTTP Worker verifies Firebase identity and a signed membership capability before routing to a name derived from both fields. The object verifies the stored owner/generation and lifecycle on every operation. Constructors do not provision active users.

Operations:

- `provision`, `suspend`, `resume`, `delete.prepare`, `delete.key`, `close`: internal membership lifecycle; monotonic lifecycle epochs reject reordered state changes. Deletion freezes writes atomically before returning retained job/key references. Fresh-authenticated key repair is limited to frozen deletion. Close retains a tombstone.
- `state`: bounded workspace summary, projects, imports, goals, board order, public settings/AI flags, compact job history, usage and workspace revision. No item bodies or credentials.
- `list`: `{cursor?,limit?}` returns `{items,next_cursor}`. Items have bounded metadata, `revision`, `has_context`, `has_content`, `has_note`, `excerpt`, `reading_minutes`, reading and compact enrichment. No full content/notes. Max 50/page.
- `detail`: `{id}` returns full item, including revision.
- `capture`, `item`, `move`, `reading`, `project`, `settings`, `classify`, `triage`: preserve local domain behavior. Mutation input includes `request_id`; existing item edits require `expected_revision`. Results include changed item/group or reading plus new revisions so the client need not refresh all bodies. `settings` accepts only goals/model, never plaintext keys.
- `import.plan`: normalized rows, at most 25, returns counts/estimated logical room without writing. `import`: `{import_id,sequence,rows,filename,request_id}` validates sequence and stores dedupe checkpoint atomically with at most 25 saves. Duplicate chunk retries do not erase edits. Server derives identity from canonical URLs.
- `export`: `{cursor?,limit?}` returns v1-compatible item pages, with bounded metadata on first page. Excludes credentials and job control records, leases and reservations. Item-level source provenance, including its retrieval run reference, remains compatible with v1 backups. Browser assembles its ZIP locally. `restore`: bounded validated v1 chunks, same identity and annotation preservation rules; groups must be bounded and references valid.
- `credential.get`, `credential.set`: internal encrypted records by provider; never public responses. Set/clear is quota checked.
- `job.begin`: `{job,request_id}` stores QUEUED and selected IDs/revisions, rejecting another active/uncertain job. An alarm atomically changes QUEUED to STARTING before one paid request. Its 120-second submission deadline exceeds the 60-second provider timeout; uncertainty never resubmits.
- `job.get`: optional id, returns internal job; normal state uses redacted public projection.
- `job.claim`: `{id,lease_id,lease_until}` serializes polling, returns job with incremented revision; expired leases can recover reconciliation. Every claim deducts modeled worst-case work from its reserved allowance, with an additional 24-claim ceiling. It never grants submission retry.
- `job.update`: `{id,expected_job_revision,patch}` applies bounded internal lifecycle changes; unknown submission stays uncertain.
- `job.apply`: `{id,expected_job_revision,candidates,cursor,terminal?}` atomically merges at most 25 source-matched retrieval or revision-checked classification candidates, advances cursor and updates job. Candidate `{id,patch,expected_revision?}`; retrieval preserves existing source text and all annotations, classification skips stale revisions. Terminal missing results are finalized only after the final provider page.

All persisted collections and operational data are bounded. A 7 MB used-page guard is a provisional implementation check, not a physical allocation guarantee. No FTS in this schema. Keep P1 prototype unchanged.

## Public HTTP and browser boundary

`GET /api/config` is public and exposes hosted mode, Firebase public config and availability only. `GET /api/session` verifies Firebase identity, reserves/provisions membership idempotently and returns a short-lived signed workspace capability. Normal APIs require bearer Firebase ID token and `X-Workspace-Session`; user-controlled UID/owner/workspace selectors are rejected. Capabilities never enter URLs or persistent browser storage. Suspension/deletion also changes the workspace lifecycle, invalidating existing capabilities immediately.

UI endpoints retain local names for mutations but hosted state is paged metadata and details are loaded on demand. `/api/items`, `/api/item?id=…`, `/api/export` return bounded JSON. Mutation request IDs and expected revisions are added by hosted transport. Downloads use authenticated fetch. Auth/session renewal retries reads once, never uncertain writes or paid submissions. Sign-out/account switch clears private state, timers and pending requests.

Hosted ZIP extraction happens in a bounded browser worker; only the selected Saved Items CSV rows go to the API in 25-item chunks. Original archives and unrelated files are never uploaded. Free-beta capacities and provider costs are separate product concepts.

Provider modules accept injected fetch, return normalized data and fixed redacted errors, and never mutate storage. Root owns job orchestration, registry, auth, API routes, shared contracts and integration. Phase owners must coordinate changes to this contract with root before editing it.
