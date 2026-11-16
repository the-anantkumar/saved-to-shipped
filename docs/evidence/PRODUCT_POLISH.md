# Product polish evidence

Date: 2026-11-17. Scope: the free local **Saved to Shipped v0.4.0b1** candidate and its shared hosted UI. This pass follows the [free-beta separation](FREE_BETA.md). Local selected-source retrieval was fixed in `136c14c`; visual/interaction changes are committed in `aa3da95`. Final artifact and CI records identify the complete release candidate.

The screenshots use synthetic local/demo content. Before views retain the prior presentation; after views show the polished interface. Reading state can change during the journey, so these are visual/interaction examples, not a controlled timing or recommendation-quality experiment. No personal archive, provider response, authenticated profile or authenticator secret is published in this set.

## Journey review

1. **First use and import.** Health: synthetic first-use checks passed. The opening surface now explains Projects, Learning and Experiences beside one import action and a demo link. It says the archive supplies links/dates, manual text is available, and import starts no provider request. The hierarchy and spacing make the first action visible without requiring provider setup. [Before](../assets/polish/before-welcome-light.png) · [After](../assets/polish/after-welcome-light.png).

2. **Return through Today.** Health: continuation and global-search checks passed. The read preview uses a larger title and a short saved-text excerpt; the build action has its own lighter section. A workspace with only unprocessed links has one Choose from Saves route, and a single continuation uses one card. Time choices and the stopping-point copy remain. [Before](../assets/polish/before-today-light.png) · [After](../assets/polish/after-today-light.png) · [Dark](../assets/workspace-dark.png).

3. **Projects and reading libraries.** Health: board/library regressions passed. Section labels, typography, quieter dividers and consistent controls clarify the current space. Projects retain their board/move workflow; Learning and Experiences remain distinct reading libraries, including typed empty sections and independent progress. Global Find and its `/` shortcut open the whole Saves collection with stale scope cleared. [Learning](../assets/polish/after-learning-dark.png).

4. **Focused reading and takeaways.** Health: reader regressions passed. Source text remains readable separately from personal notes. The reader keeps the original-source link, coverage labels, saved progress and explicit Mark read action; scroll position does not silently complete a read. The finish area offers a takeaway and a return to the library. [Reader](../assets/polish/after-reader-light.png).

5. **Notes and source edits.** Health: discard, save-retry and late-poll regressions passed. The editor is named Your notes, with Post text kept in a separate disclosure. Escape, Cancel and backdrop clicks preserve dirty text until an explicit discard choice. A failed save keeps both fields editable; retry persists them and returns focus to the invoking Notes control. An older manual polling response can refresh workspace data but cannot replace a newer notes editor or its draft. [Before](../assets/polish/before-notes-light.png) · [After](../assets/polish/after-notes-light.png).

6. **Provider setup and retrieval.** Health: exact-selection and approval checks passed with mocked providers; live source fidelity remains limited. Settings keep retrieval/AI optional and explain user-owned charges. The shared retrieval form submits exactly the chosen IDs and requires charge approval. The local API now resolves those selected owned saves, rejects invalid or changed selections, and preserves uncertainty/reconciliation behavior. Saving keys/importing does not submit work. [Settings](../assets/polish/after-settings-light.png). Review found that the prior local API ignored explicit IDs; `136c14c` closes that paid-scope defect.

7. **Optional authentication.** Health: synthetic auth/MFA checks passed; deployed real-account acceptance remains pending. The hosted sign-in presentation uses the same product name, hierarchy and theme. Google and verified Email/password plus required TOTP flows retain their existing identity and cancellation guards. The public sign-in view contains no entered credentials or account identity. Enrollment/challenge captures remain ignored so no authenticator secret is published. The local release requires no account. [Sign-in](../assets/polish/after-signin-light.png).

8. **Narrow screens and keyboard use.** Health: scoped layout and keyboard checks passed. Navigation, reading, forms and modal actions were exercised in light/dark layouts. The final capture matrix contains 37 visual/layout views at 1440, 390 and 320 pixels plus a 1920-pixel view; it recorded zero browser errors and at most one pixel of document overflow, with no clipped controls. Independent checks also covered 320/375/768/1440 widths. [Mobile Today](../assets/workspace-mobile.png). This is scoped layout evidence, not a full assistive-technology certification.

## Checks actually completed

| Check | Result |
| --- | --- |
| Python behavior | 91 tests passed, including local exact-selection/approval and unavailable/invalid selection cases. |
| Shared JavaScript behavior | 36 tests passed. |
| New local/shared interaction checks | Five checks passed: first-use/keyboard Find, explicit dirty-note discard, failed-save retry/focus return, and delayed local/hosted polling preserving newer notes. No provider submissions or browser errors. |
| Hosted browser acceptance | Product 7, reader 5, E2E 9, auth 5, MFA 11 and UAT controls 10 acceptance groups passed. E2E now explicitly discards its intentionally edited note before leaving that dialog. |
| Visual/layout capture | 37 views, zero runtime errors, maximum document overflow 1 px; final Today, welcome, reading, notes and settings views inspected by the coordinator. |
| Browser identity/motion | Product tab title and HTTP 200 for the packaged favicon verified. Sampled reduced-motion styles computed to no animation and zero-second transitions. |
| Palette spot checks | Light muted text 5.09:1 and primary 7.70:1; dark muted text 9.32:1 and primary 8.97:1. These sampled combinations do not establish compliance of every state. |
| Independent review | Final PASS for the scoped local OSS candidate, with no actionable findings. The selected-URL and late-poll editor-replacement defects were independently reproduced and closed. |
| Final release artifact/CI record | Pending the clean, committed candidate with final documentation/assets. Publication and hosted deployment are not established by this report. |

## Health and remaining limits

This pass made no paid provider calls. The local/shared browser tests use isolated synthetic state, mocked responses and explicit disposal. Auth tests are distinct from a deployed real-account acceptance run. Source identity, notes, v1 backup compatibility, technical quotas and the independent reading model remain preserved.

The owner accepted the sample preview; the personal five-save/next-day usefulness trial is still a separate record in [UAT](../UAT.md). Broad source-retrieval fidelity, complete attachments, a capped/ordered Read next shortlist and session summaries are not claimed. The optional hosted service remains closed while its existing daily-work calibration, real identity/recovery and cloud-capacity gates are completed. See the [release checklist](../RELEASE_CHECKLIST.md) and [launch handoff](../LAUNCH_HANDOFF.md).
