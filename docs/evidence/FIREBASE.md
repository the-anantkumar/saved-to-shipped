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

## Phase F3: Required authenticator two-factor authentication

Date: 2026-11-15. Based on `7df4342` and added to the same Firebase task branch. The user explicitly selected required authenticator-app MFA for Email/password accounts. Google-only sign-in remains available.

The API now requires a verified email and the signed nested Firebase TOTP claim on every password-authenticated request. The browser gates enrollment before requesting a seat, creates QR codes locally, confirms a code and backup acknowledgement, and clears the setup key. Native enrollment can open the workspace immediately when its updated token proves TOTP; a token without that proof requires a fresh sign-in. Later sign-ins and sensitive reauthentication handle native TOTP challenges, retries and cancellation. The app never handles SMS or implements its own TOTP validator.

Cloud configuration actually performed: upgraded Authentication to Identity Platform while retaining Spark; enabled TOTP with one adjacent interval; retained disabled SMS providers. Console and API checks confirmed billing is disabled. This feature upgrade is irreversible and introduces the documented Spark limit of 3,000 daily active users. Neither the project owner's factors nor provider credentials were changed.

Independent review found and reproduced a cancelled-resolver race before this checkpoint: Firebase could publish and persist an old identity after the user left the challenge screen. The fix serializes auth operations, rejects stale identity changes through Firebase's blocking observer, signs out the native user immediately, and suppresses stale token notifications from reauthentication. Newer sign-ins wait for outstanding work; late first-factor errors cannot replace them. The final review found no unresolved findings.

A temporary synthetic account passed six live assertions using Firebase's native modular SDK and the actual production Worker entrypoint:

1. A real verified password-only token is rejected.
2. Native TOTP enrollment succeeds; an incorrect enrollment code is rejected.
3. A fresh password-plus-TOTP sign-in produces trusted second-factor proof.
4. The Worker saves and reads a synthetic private note in Firestore, while the password-only token cannot export it even with a valid workspace capability.
5. The workspace and temporary MFA identity are removed through verified deletion.
6. Billing remains disabled afterward.

Native enrollment was also observed to issue a token carrying TOTP proof, allowing immediate workspace opening without a redundant second sign-in. A fresh code interval was used for the separate sign-in assertion. No real email delivery, paid provider or personal archive was used. Authenticator-loss recovery remains an operator procedure requiring identity verification; it was not simulated by weakening a real account. Local reports retain only assertion names, not secrets or tokens.

Final F3 verification: TypeScript/build passed; the hosted suite passed 119 tests with 14 emulator-dependent checks explicitly skipped because the emulator was stopped. The authenticator browser suite passed 11 checks, including native-adapter cancellation before persistence, account ordering, immediate enrollment with proof, and the no-proof fallback. Existing email verification/reset browser checks passed five checks; the nine general end-to-end and ten UAT-control checks also passed. The deployment dry run and nine-artifact boundary checks passed. Independent review passed the focused authentication suite and the cancellation reproductions, with no unresolved findings; the final immediate-enrollment change was also reviewed. These checks do not certify authenticator-loss support staffing, real mail delivery or a public deployment.
