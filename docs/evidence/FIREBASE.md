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

Live Google popup completion and real verification/reset mail delivery are not established by the synthetic browser checks. Firestore storage, failure recovery and deployed rules are a separate phase; the F1 checks do not certify those behaviors or production capacity.
