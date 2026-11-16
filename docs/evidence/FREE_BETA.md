# Free-beta separation evidence

Scope date: 2026-11-15. Branch: `feat/free-beta-oss`, starting from `da7652b`. Implementation checkpoint: `259f251`. The subscription prototype is preserved on `feat/firebase-backend` and `checkpoint/paid-subscriptions-2026-11-15`; no merchant service was activated.

## Candidate boundary

The candidate physically removes payment runtime/UI, paid tiers, organization points, merchant configuration and payment tests. Firebase identity/Firestore persistence, BYOK jobs, technical quotas and useful product refinements remain. No card requirement or expiry countdown is part of owner UAT. The local MIT application remains dependency-free and account-free, and v1 backups preserve source, annotations, separate reading progress, typed sections and time preferences.

Today offers one Choose from Saves action for imported links without a continuation, one card when only a read/build step exists, and the read/project pair when both exist. Choosing Saves clears stale filters. These choices do not start provider work.

Historical [product refinement checks](PRODUCT_REFINEMENTS.md) describe the previous branch; their payment passes are not validation of this candidate.

## Completed verification

All provider/payment-like inputs were synthetic. Node 24, Python 3.12 and the pinned hosted dependencies were used. Firestore checks targeted only the loopback Enterprise emulator with project `demo-save2ship`, database `save2ship`.

| Boundary | Result |
| --- | --- |
| Hosted types and behavior | Typecheck passed. `npm test`: 126 passed, 16 emulator-dependent checks skipped. The separate full emulator run passed all 16. Together these cover 142 distinct hosted checks. |
| Beta product API | Selected owned IDs, invalid/foreign selections, private weekly preferences, and ordinary 20+1-item AI batches passed. Former payment routes return 404 and start no provider work; no credit allowance is present. |
| Technical storage/compatibility | Five focused beta tests cover growth-only item limits, edits/export after cap reduction, more than 100 saves/3 sections/20 AI applications, atomic section-cap rollback, v1 restore and incompatible-state recovery. |
| Browser product flow | Seven acceptance groups passed, including imported links to unfiltered Saves, single/both Today continuations, typed empty sections, weekly preferences, global search, explicit retrieval IDs/charge cap, and free-beta capacity rejection preserving drafts/data/export. Zero runtime errors; dark mobile inspected. |
| Browser regressions | Reader 5, E2E 9, UAT controls 10, email auth 5 and MFA 11 acceptance groups passed. Shared JavaScript behavior: 32 passed. |
| Local/package | 84 Python tests passed. Fresh wheel and source archive built at version 0.3.0, passed strict metadata/content validation, and both passed clean-install organizing/reading/export/restart checks without provider accounts. |
| Production artifact boundary | Closed deployment dry run and nine-artifact check passed on the split working tree. Browser/Worker input graphs exclude paid modules; the Worker has no merchant endpoint URLs or test bypass. The final clean documentation checkpoint is hashed separately in the MR/CI record. |
| Independent review | PASS with no unresolved material findings. Reviewer ran 43 app/storage/API tests, 7 final beta/Firestore regressions, auth 5/MFA 11 browser checks, and inspected production dependency graphs. |
| Owner first-session and next-day acceptance | Pending user UAT; automated passes do not establish usefulness. |

## Review finding closed

A compatibility fence rejects workspaces containing another build's private billing ledger, after verified ownership, rather than silently purging financial lifecycle state. Standard v1 backups exclude that state and restore into a fresh beta workspace.

Review found that a due alarm for an incompatible workspace initially threw and could trigger background retries. The fix handles only `WORKSPACE_BUILD_MISMATCH`: local alarms stop normally, explicit Firestore repair returns false, and the bounded cron result counts quarantine separately from failure. Remote checkpoints/records remain unchanged, other faults still propagate, and no provider reconciliation runs. Independent reproduction confirmed closure, including cache loss and repeat repair without rearming.

## Publication preparation and limits

Read-only GitHub metadata still identifies the repository as private. The PyPI project page returned 404 during preparation; this is not verification of name ownership or a publish target. The private vulnerability-reporting API also returned 404, so that reporting route remains unverified before public visibility.

An initial heuristic scan covered 493 unique reachable Git blob versions (5,074,321 bytes) across local refs. It found no candidates for the checked private-key, OpenAI/Apify/GitHub/OAuth-secret/cloud-access-key patterns. Two sensitive-path matches were encryption source/test modules, not credential files. A current tracked-content scan found no personal home-path, Gmail-address or named-archive candidates. Matched values were never logged. This bounded scan does not establish that every possible secret or private artifact is absent; final publication review and reporting-route verification remain gates.

No package, repository visibility change or hosted deployment was performed. Provider fidelity/actual charges, real owner acceptance, deployment identity/recovery and measured hard-free cloud capacity remain distinct from these local/emulator checks. Read next ordering/capping, skip/replace controls and a session summary remain product follow-ups. See [scope](../FREE_BETA.md), [owner UAT](../UAT.md) and [shipping gates](../SHIP_PLAN.md).
