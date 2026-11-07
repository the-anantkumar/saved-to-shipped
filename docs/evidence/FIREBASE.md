# Firebase backend evidence

Date: 2026-11-07. Branch: `feat/firebase-backend`, based on the tested UAT checkpoint `622f30c`. This branch depends on the hosted release foundation in PRs 7 and 8; it was not cut from an older main that lacks that implementation.

## Phase F1: Email/password and Google authentication

The production browser adapter supports Google sign-in and email/password registration, sign-in, reset and email verification. Password identities must have a verified email before either the UI or API permits workspace admission. Persistent Firebase sessions and identity-scoped cache resets remain in place. Password-only accounts reauthenticate with a password before deletion; Google-linked accounts can use Google confirmation.

Validation on the F1 working tree:

- TypeScript, build and changed JavaScript syntax checks passed.
- Six targeted identity and adapter tests passed.
- Five browser authentication checks passed, including verification-mail failure recovery, the gate before `/api/session`, reset privacy, password reauthentication and sign-out cleanup.
- The existing nine browser end-to-end and ten UAT-control checks passed.
- An independent reviewer reran five adapter/provider checks and all five auth browser checks. No confirmed findings remained in this scope.

Firebase setup actually performed:

- Authenticated CLI access to the existing `save2ship` project.
- Registered `save2ship-web`, app ID `1:933694610833:web:7877ad92be0cf665ff0e30`.
- Deployed Email/password and Google sign-in provider configuration, including `localhost` for development.
- Verified billing is disabled. No billing account was linked or paid plan enabled.

Public SDK configuration is stored in the developer's ignored local setup directory. Server credentials, authenticated browser state and personal workspaces are not evidence artifacts.

F1 was committed as `87fde3f`. The synthetic browser checks do not establish real verification/reset mail delivery. Live Google and Firestore checks are recorded separately below.

## Phase F2: Firestore authority and configured development runtime

Firestore now holds membership, quota reservations, workspace rows, encrypted credentials, jobs and receipts. The existing SQLite model is a disposable projection behind per-user Durable Objects. Atomic checkpoint commits, compare-and-set fences, pending-write markers and commit IDs prevent an uncertain response or stale projection from becoming authority. Separate Firebase namespaces reject accidental fallback to the old SQL backend. Deletion freezes work first, authorizes purge only after provider reconciliation, and releases the membership seat after cleanup.

The existing `save2ship` project has a named Enterprise Native database, `save2ship`, in Mumbai (`asia-south1`), with Core access and free tier enabled. Billing remains disabled. Delete protection is enabled; paid TTL, backup, PITR and Functions are not enabled. A dedicated database-scoped runtime service account is configured locally. Rules deny all direct browser access, including authenticated reads; the trusted API enforces tenant authorization. Rules and the three maintenance indexes were actually deployed.

Validation on the final F2 working tree:

- TypeScript and build passed. The hosted suite passed 124 tests with the Firestore emulator running. Two subsequently added checks passed separately: direct-client Security Rules denial, and the complete Firestore API flow with mocked providers.
- The 32 shared JavaScript behavior tests passed.
- The final browser fixture passed nine end-to-end, ten UAT-control and five authentication checks, with no runtime errors. These use synthetic identities and providers.
- An independent reviewer passed 28 focused client, registry and workspace checks against the Enterprise emulator. The final review found no unresolved material security or correctness findings.
- The application deployment dry run and release boundary checker passed, hashing nine artifacts. No Worker deployment occurred.

Review and real-runtime findings were fixed before this checkpoint: deletion could purge before provider reconciliation; recovered projections could lack scheduler identity; a backend flag could allow SQL fallback; and Worker fetch calls rejected `redirect: error` or an unbound receiver. A real Enterprise request also rejected explicit document ordering accepted by the emulator. Worker-level fetch tests now exercise the actual runtime, and pagination uses the API's default document-name order.

The live production-entrypoint check used one temporary synthetic Authentication identity and real project storage. All seven assertions passed:

1. An unverified password identity cannot open a workspace.
2. A real signed Firebase token opens an idempotently admitted workspace.
3. Capture, editing, grouping, reading progress, Unicode note search, export and optimistic conflicts work.
4. Deployed rules reject direct reads with a signed-in user's token.
5. A fresh Worker reconstructs the complete workspace from Firestore.
6. Workspace records and encrypted credentials are purged before the seat is released.
7. A deleted generation cannot recreate its workspace.

The temporary Authentication identity was removed afterward. Terminal deletion markers remain as designed. No real provider was called. The redacted local report contains check names only; raw tokens, credentials and account details are not evidence artifacts.

The selected Google account completed the real popup flow and opened the workbench at `http://localhost:8012/` without another sign-in. Local admission contains only that account; archive import is enabled. The archive preview was left ready for the user, without submitting its contents as part of the synthetic tests.

## Remaining release evidence

Real email verification/reset delivery, deployed Worker behavior, production Firestore operation/storage metering and a measured cohort limit remain outstanding. Live paid provider behavior was not tested in this phase. The earlier 500-member SQLite allocation cannot be advertised for a database with 1 GiB total free storage. This checkpoint completes the configured Firebase development backend; it does not certify a public beta or its capacity.
