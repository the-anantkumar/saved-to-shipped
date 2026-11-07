# Firebase development setup

The hosted workbench uses Firebase Authentication for Google and verified Email/password accounts, and Firestore for authoritative private data. A Cloudflare Worker runs the trusted API and provider jobs. The account-free Python application still runs independently with `python3 server.py`.

## This project's configuration

| Setting | Value |
| --- | --- |
| Project | `save2ship` |
| Web app | `save2ship-web` |
| App ID | `1:933694610833:web:7877ad92be0cf665ff0e30` |
| Database | `save2ship` |
| Edition | Enterprise, Native mode with Core access |
| Location | Mumbai, `asia-south1` |
| Billing | Disabled, Spark, free-tier database |
| Development origin | `http://localhost:8012` |

The project, app, providers, database, rules and indexes are configured. Its dedicated runtime service account has `roles/datastore.user` with an IAM condition restricting it to this database. It has no Authentication administration or project-owner role. Its key stays in an ignored local file and must become a server secret when deploying.

## Run the configured app

From `hosted/`, use Node 24 and the locked dependencies:

```sh
npm ci
npm run firebase:local
```

Open [localhost:8012](http://localhost:8012/). Google opens an account picker and returns to the app. Email registration sends a verification email; verify it and select **I've verified my email** before opening a workspace. Password reset and verification resend are explicit actions.

The launcher reads these ignored files under `hosted/.local/firebase-project/`:

- `web-config.json`: `apiKey`, `authDomain`, `projectId`, `appId`, and `databaseId`. Firebase's web API key identifies the app; it is not an administrator credential.
- `service-account.json`: private server credential, never copied into browser assets or exports.
- `members.json`: an explicit JSON array of at most two permitted Firebase UIDs for local UAT. An absent file means admission is closed. Sign-in can succeed while the app displays **beta full**; add only the intended UID from Firebase Authentication, then restart.
- `local-secrets.json`: generated once and reused for workspace sessions and encrypted provider keys. Preserve it across restarts.

The launcher generates a loopback-only Wrangler configuration and a mode-0600 `.dev.vars` file. It never publishes the app. Add `-- --processing` to enable archive import and provider processing for this local instance. Provider keys remain user-owned; saving a key does not start a request. Without that flag, manual capture, organization, notes, reading and export work while import and processing remain paused.

```sh
npm run firebase:local -- --processing
```

## Reuse with another Firebase project

1. Sign in with `npx -y firebase-tools@latest login --interactive`, select your project, register a web app, and fetch its SDK configuration. Keep billing disabled. Select the database edition and permanent region before creating it.
2. Enable Email/password and Google. Firebase CLI supports an `auth.providers` block with `emailPassword: true` and `googleSignIn` containing your display name, support email, and authorized redirect URIs. Deploy it with `npx -y firebase-tools@latest deploy --only auth --project YOUR_PROJECT`. Use `http://localhost` without a port in the provider setup; the app's origin includes its port.
3. Update `hosted/.firebaserc` and `firebase.json` for your project/database. Deploy this repository's rules and indexes with `npx -y firebase-tools@latest deploy --only firestore --project YOUR_PROJECT`. Direct browser database access is intentionally denied. All workspace access passes through the authenticated API.
4. Create a dedicated runtime service account and grant only `roles/datastore.user`, conditioned on `resource.name=="projects/YOUR_PROJECT/databases/YOUR_DATABASE"`. Store its JSON key in the ignored local path above. Do not use a project-owner key or commit credentials.
5. Create the local public configuration, run the launcher, sign in, and add the intended UID to the local allowlist. Deploying a hosted instance is a separate step in the [shipping plan](SHIP_PLAN.md).

See the official [Authentication guide](https://firebase.google.com/docs/auth/web/start), [database IAM conditions](https://firebase.google.com/docs/firestore/manage-databases#configure_per-database_access_permissions), and [Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api).

## Storage and recovery contract

Firestore holds workspace records, encrypted provider keys, membership, quotas, request receipts and jobs. The Worker retains a disposable SQLite projection for fast full-text search and board operations. Every invocation checks the authoritative checkpoint. Writes become successful only after an atomic Firestore commit; a lost response is reconciled by commit ID and request receipt. Cache loss rebuilds from Firestore. It never creates cloud data from an unconfirmed cache.

Deleting a workspace freezes it, stops a known external provider run, and only then authorizes paginated deletion. Unknown provider submissions remain blocked for manual reconciliation. The membership seat is released after data and credentials are purged. Alarms and a bounded five-minute scheduled scan recover job wakeups; local development can trigger the scheduled handler manually using Wrangler's local scheduled endpoint.

Enterprise Core document operations are used for atomic commits, checkpoint reads and reconstruction of the offline projection. Small indexed Core queries handle membership and cleanup. The browser does not query Firestore or use pipelines, and a full library is not reread from Firestore for each search keystroke.

Production uses distinct `FirebaseWorkspace` and `FirebaseRegistry` Durable Object namespaces. Roll back only to a Firestore-compatible build. Switching a namespace back to SQL mode is rejected after Firestore use. Older local/SQL workspaces are not migrated automatically: export a version-1 backup and restore it into the chosen hosted identity. Never point this launcher at a personal Python data directory.

## Verification and capacity

Use Java 21+ for the Firebase emulator. These tests use `demo-save2ship` and synthetic data:

```sh
npm run typecheck
npm test
npx -y firebase-tools@latest emulators:exec --only firestore --project demo-save2ship "node --test tests/firestore-emulator.test.mjs tests/firestore-workspace.test.mjs tests/firestore-rules.test.mjs tests/firestore-app.test.mjs"
npm run test:auth-ui
npm run test:e2e
```

The deployed rules deny direct access even to authenticated users; the API enforces tenant identity and data validation because trusted IAM access bypasses Security Rules. See the [phase evidence](evidence/FIREBASE.md) for checks actually completed and their limits.

Keep admission closed until cloud usage has been measured. Firestore Spark provides **1 GiB total storage**, so the earlier 500-member allocation of 8 MB each cannot fit this backend. That previous SQLite capacity model does not certify Firestore. Enterprise read/write units, record overhead, the SQLite cache, deletion tombstones, indexes, retries and background work all need measurement before choosing a public cohort. No billing upgrade, paid TTL, managed backup or Cloud Functions deployment is part of this setup. [Firebase pricing](https://firebase.google.com/pricing)
