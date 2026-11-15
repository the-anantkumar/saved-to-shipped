# save2ship product audit

Date: 2026-11-15. Baseline: `7df4342` workspace flows; auth is being changed concurrently and was deliberately excluded from this review. Scope: the hosted workbench as used by a developer who has hundreds of LinkedIn bookmarks, short available sessions, and trouble returning to previously saved ideas.

## Verdict

The product is a credible organizer with a useful focused reader and task board. Its return-to-action loop is incomplete. It currently asks the user to process a backlog before enjoying it, and it lacks a persistent, cross-space answer to “I have 15 minutes; what should I do with something I already saved?” I would use it for a deliberate cleanup session today, but would still need to remember to open it and choose where to go tomorrow.

One actual reading defect blocks the core promise and should be fixed before owner UAT. Two other observed behaviors undermine trust in organization/planning. The remainder are product gaps, not claims that the backend is broken.

## Evidence and limits

- Read current architecture, UAT instructions, shared browser code, hosted archive/transport and storage/job contracts.
- Started a disposable synthetic UAT server at loopback, then used native Safari through CUA. No personal archives, Google account, real provider account or cloud data were used.
- Used Alice's three seeded examples to inspect landing, reading queue, reader, topics and weekly budget. Used Bob's empty workspace for a genuine first-use import of a three-row synthetic Saved Items CSV, provider setup, mocked retrieval and AI classification, opening the resulting Learning article, saving a takeaway and marking it read.
- Source recovery/classification quality against real LinkedIn was not evaluated. Workload counts below use an illustrative 500-post archive and configured batch limits, not a timed large-archive benchmark.
- Browser evidence consists of observed accessibility state and a synthetic reader screenshot in the tool transcript. No authenticated browser state or personal data was written as evidence. The disposable server stopped during the environment reset and no listener remains; Safari has no audit tab open. A final note-search edge case was interrupted and is excluded from confirmed findings.

## Findings, in priority order

### P1: Queuing a read can make its source text and notes disappear from the reader

**Observed defect.** Alice > Learning > bookmark “How to read an unfamiliar codebase” for Read next > Start reading. The article displays its title/byline, an empty body, and “Only your notes are available for this save.” The source excerpt existed in the library, and the seed has eight paragraphs plus a note. Reloading the same reader URL restores all eight paragraphs and the note. Data is retained; the visible reading state is wrong.

**Cause:** `hosted/client/transport.mjs:216` remembers the full item returned by a reading mutation and marks it hydrated. `saved_to_shipped/web/reading.js:80` updates only reading/revision on the UI's existing metadata object. `reading.js:100` then skips hydration when the transport claims to have detail, leaving the UI object without content or note.

**Smallest fix:** synchronize the authoritative returned full item into UI state after a reading mutation, preserving the existing identity/epoch/superseded protections, or hydrate UI state from the transport before rendering. Cover queue-before-open with an assertion on actual reader body text and notes, not only the backend item or reading status.

### P1: Return visits do not offer one coherent next action across all saved work

**Observed landing plus product gap.** Alice opened `/` on Projects although she also has unread Learning and Experiences. Root navigation chooses Projects whenever any project exists (`saved_to_shipped/web/app.js:249`). The Saves “UP NEXT” block prioritizes project review, then classification, then missing content (`onboarding.js:25`), so remaining archive processing can become the persistent attention sink. Learning has a useful continue-reading choice, but it is only visible after choosing that space.

**User impact:** I solved storage/organization but still have to remember the system, choose a destination, and decide what matters. A large archive can become a second guilt-producing inbox.

**Smallest coherent fix:** make the existing entry surface offer a small focus session: one unfinished/queued read and one active build step, with “I have 5/15/30 minutes.” Keep the full archive secondary. Explicitly let me finish after one useful thing without clearing the backlog. This can reuse current progress, queued state, effort and task status; it does not require a recommendation model or another board.

**Acceptance:** returning with a half-read article and an active task gives an immediately visible continuation. Hundreds of unprocessed links do not replace that choice with “process more.”

### P1: The user cannot deliberately choose which posts incur retrieval work

**Observed UI plus code.** After importing Bob's three link-only rows, the list shows three indistinguishable “Saved LinkedIn post” entries. “Process 3 saves” opens a run-size/charge form, with no selected URLs or selection criteria. The run-size dropdown says 10 saves despite only three being eligible. `archive.mjs:84` imports URL/date only; `app.js:308` shows generic title/author/date. `jobs/orchestrator.ts:37` selects the first eligible records from the list; `storage/workspace.ts:232` lists by hashed item ID, not recency or user relevance.

**User impact:** the product promises less friction but asks me to authorize paid recovery on an opaque slice of my bookmarks. I cannot start with the ten recent posts I actually care about, or see what the next run contains.

**Smallest fix:** show a bounded selection preview and a clear default such as latest saved, with an explicit “retrieve selected” action. Display URL-derived source hints only as identifiers, never invented post summaries. Let me choose a small worthwhile slice and leave the rest dormant.

### P2: “This week” is not a saved plan

**Observed defect/expectation mismatch.** Set the weekly budget from 6h to 2h; the displayed breathing room updates. Reload the same `#week` URL; it resets to 6h. `app.js:47` initializes an in-memory `hours=6`. `app.js:350` dynamically chooses up to two tasks by score, ignores explicit board order and offers no “commit these two to this week” control.

**User impact:** my available time is forgotten and my apparent weekly commitments can change when tasks change. It feels like a plan but behaves like a suggestion calculator.

**Smallest fix:** persist the user's budget and explicit short list, with active work first. Alternatively rename the current view “Suggested next” until a real weekly plan exists. A good first iteration needs no calendar sync.

### P2: A newly created empty topic disappears immediately

**Observed defect.** Learning > New reading topic > create “Synthetic systems notes.” A success toast appears, but the topic is absent from Your topics. `reading.js:57` shows only sections containing items; the board's filter has the same used-only pattern (`app.js:342`).

**User impact:** I create a place for future learning, receive confirmation, then cannot find it. This is especially confusing during initial organization.

**Smallest fix:** keep empty sections visible with an empty state and a direct “add existing saves” path, or route creation through assigning the current save so there is a visible result. Preserve Projects/Learning/Experiences distinction; the shared generic group list currently offers every section in assignment dropdowns (`app.js:423`).

### P2: Large-archive onboarding creates many repeated provider/organization decisions

**Code-derived gap.** Hosted retrieval accepts 10 or 25 per explicit run, AI organization up to 20 per batch (`onboarding.js:140`, `app.js:597`). Processing an illustrative 500 saves takes at least 20 retrieval starts at the larger batch size, or 50 at the default 10, plus 25 AI starts if all become readable. Import itself chunks automatically; retrieval/classification deliberately require separate actions to control cost.

**User impact:** the cost controls are valuable, but there is no visible “you can stop after five useful items” outcome. Users may infer that making the archive useful requires repeated administrative work.

**Smallest fix:** optimize the first session for five handpicked saves and one completed outcome. Show recoverable/blocked content distinctly, retain explicit charge approval and uncertainty handling, and allow a bounded batch plan only when the user explicitly chooses its total scope/cost. Do not auto-submit an entire archive or subsidize provider usage.

### P2: Useful content can still become a second unbounded reading queue

**Code-derived gap.** Read next is a boolean per item with no deliberate short-list size/order. Reading priority is unfinished first, queued next, then saved date (`reading.js:31`). The same unfinished or newest item wins the sidebar indefinitely; old valuable content does not reappear unless searched or manually scoped. No return intent, review date or small completed-session summary is stored.

**Smallest fix:** keep Read next intentionally small (for example three), explain why a suggestion appears, and let the user replace/skip today's choice. After reading, preserve a takeaway and offer one related action; stop there. An optional return reminder can come later, after the in-app return path is useful.

### P2: Finding a forgotten item assumes remembering its category or wording

**Code-derived gap.** Search is full text and includes notes, which is strong. It is surfaced inside Saves or the current reading library, without a universal search affordance. A user who remembers an idea but not whether it was Learning, Experience or a project must first choose the correct space or know that Saves is the global collection. Keyword matching also cannot infer a forgotten synonym.

**Smallest fix:** label one visible global “Find a saved idea” search, return mixed results with kind/topic badges, and preserve local filters as optional refinement. Do not add semantic search before validating whether this makes existing search sufficient.

## What already works well

- Three distinct destinations fit the intent of building, reading and collecting experiences; the focused reading layout is calm and legible in dark mode.
- Read next, time filters, continuing unfinished reading, original-source links, coverage notices and notes separate from source text are good foundations.
- Source import is explicit about which data leaves the device, gives a review step and capacity information, and preserves repeated-import annotations.
- Provider key saving does not launch a job. Charge approval and uncertain-submission recovery are deliberately explicit. This is the right boundary to preserve while reducing repetitive clicks.
- Small next action, definition of done and a two-task limit are more useful than a giant generated backlog. Export and account-switch/deletion protections help trust.
- The complete synthetic first-use journey reached a readable article, accepted a separate takeaway and visibly marked the article Read. Classification completion correctly pointed to Open Learning; its generic “drafts ready to review” toast is slightly inconsistent with the project-only To review count of zero.

## How I would use it

1. Import my archive once; don't try to clear it.
2. Choose five saved posts relevant to one current goal and recover only those.
3. Keep one build action and at most three Read next choices; park the rest.
4. Return for a 15-minute session. Continue a half-read item or advance the current build without reorganizing everything.
5. Record one takeaway or a tangible result, mark it done, then leave.
6. Once a week, replace the short list rather than append to it.

## Suggested delivery order and acceptance

1. **Trust fixes:** blank reader after queue; visible empty sections; persist or honestly rename weekly planning. Re-test actual rendered content.
2. **First useful session:** selected retrieval preview, clear post-content requirements, five-post path, one read/action completed without processing all imported saves.
3. **Return loop:** resume and active work on entry, deliberate short list, one simple global search, visible completion.
4. **Owner UAT:** use a representative portion of the real archive, return the next day without instructions, and measure whether something saved becomes useful. This remains separate from automated correctness tests.

Proposed evaluation targets, not measured claims: first useful read/action within five minutes after content is available; returning user finds a continuation within 10 seconds; a 15-minute session produces one takeaway or action without backlog cleanup; notes and progress remain intact after reload/re-import. Compare against simply opening LinkedIn Saved Items. If the app only makes organization more attractive, it has not yet met its core promise.
