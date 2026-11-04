# Saved to Shipped: personal LinkedIn workbench

**Problem:** useful saved LinkedIn posts disappear into a bookmark collection. The owner wants small project ideas and a backlog, plus a working project they can demonstrate.

**Success:** import saves without losing annotations, provide enough context to classify promising ideas, review a concrete next action, and ship one useful outcome.

## Current experience

1. Run one Python command and open the local browser app.
2. Try an isolated synthetic workspace immediately, without waiting for an archive.
3. Import the official LinkedIn ZIP or Saved Items CSV, or manually capture a LinkedIn link with context.
4. Add post text or a personal note to otherwise URL-only saves.
5. Classify using offline keyword suggestions, an explicit OpenAI API action, or a ChatGPT prompt/response exchange.
6. Organize related saves into project groups and review task details.
7. Track Ready, In progress, Shipped, and Parked items. Record a result URL.
8. Fit up to two reviewed build tasks into a weekly budget and export the backlog, sprint, and local issue drafts.

## Acceptance criteria

| Requirement | Verification |
| --- | --- |
| Import official archive shape | Nested Saved Items CSV, common names/headers, BOM, missing/ambiguous/corrupt files tested |
| Safe repeat import | Same links add zero duplicates; source fields fill blanks and annotations remain |
| Honest evidence | URL/title-only saves cannot be classified or become ready tasks |
| Usable without keys | Offline suggestions and manual editing complete the workflow |
| Optional semantic classification | Strict structured output, complete ID coverage, atomic validation, actionable provider errors |
| Project grouping | Multiple saves share a stable project ID; user can reassign them |
| Concrete backlog | Title, context, action, done condition and 0.25 to 2 hour estimate required |
| Durable personal data | Atomic local JSON, ignored by Git, separate synthetic demo store |
| Export | JSON backup, CSV table, time-budgeted Markdown sprint, local issue Markdown |
| Personal scope | No hosted service, login flow, remote database, or scaling infrastructure |

## Known boundaries

LinkedIn's Saved Items export contains saved dates and URLs, not third-party post bodies. Automatic post retrieval is not implemented. A real archive smoke test is pending the owner's download. Native Reddit/Instagram input is outside the web release; inherited CLI adapters remain available.

Local rules provide broad heuristic suggestions and generic actions. They do not understand the source semantically. The optional LLM route is implemented and tested with mocks; a real account/key request is a separate smoke test. Human review stays part of the workflow.

The app runs as one local process. Concurrent CLI edits, public hosting, collaboration, automatic GitHub publishing, reminders, OCR, and authenticated crawling are out of scope.
