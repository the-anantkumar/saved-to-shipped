# Security

Save2Ship is a personal application for a trusted local computer. It binds to IPv4 loopback, validates Host headers, and requires a per-run token for writes. The local Python server has no shared-user authentication or public-hosting boundary. A separate closed hosted implementation exists under `hosted/`; it is not deployed and must not be replaced with a public proxy to the local server. Keep personal archives, workspace backups, and provider credentials out of source control and public reports.

Provider calls start only through the retrieval or classification flow. Selected URLs go to the configured extractor; selected text, notes, and goals go to the optional model provider. Credentials are stored separately from workspace exports. Local file permissions depend on the operating system; private temporary-file permissions are checked on POSIX systems. Windows relies on the account's data-directory access controls.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** route when private reporting is available. If there is no private reporting route, open an issue requesting a private contact without including the vulnerability details. Do not post credentials, real archives, private saved text, or unredacted logs in a public issue.

Provide the affected commit or version, operating system, a synthetic reproduction, and the impact. Development is currently on `main`; no stable supported package release has been published. Enable and verify private vulnerability reporting before making the repository public.


## Closed hosted implementation

The hosted API verifies Google identity, a short-lived UID/generation capability and per-workspace lifecycle. Provider credentials use server-side AES-GCM encryption with owner/provider binding and remain outside exports. Browser account switching clears private state. Production builds exclude the synthetic identity/provider fixture; never deploy `tests/*harness*` or `client/test-bootstrap.mjs`.

App suspension blocks workspace access immediately after the operation completes. Firebase revocation is checked on session renewal; ordinary access can persist for up to 15 minutes while the ID token is valid. Administrative actions and account deletion perform fresh account checks. Deletion freezes writes before provider reconciliation and retains a restricted key-repair/retry path if abort fails.

The default deployment is disabled with zero seats. Final-schema physical capacity, real Google login, live providers and platform recovery remain release gates. [Hosted operations](docs/HOSTED_OPERATIONS.md) describes incident controls, key retention and rollback limits. Synthetic tests establish implementation behavior; they do not certify deployed isolation, provider fidelity or free-platform capacity.
