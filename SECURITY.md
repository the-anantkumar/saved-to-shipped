# Security

Saved to Shipped is a personal application for a trusted local computer. It binds to IPv4 loopback, validates Host headers, and requires a per-run token for writes. The local Python server has no shared-user authentication or public-hosting boundary. A separate closed hosted implementation exists under `hosted/`; it is not deployed and must not be replaced with a public proxy to the local server. Keep personal archives, workspace backups, and provider credentials out of source control and public reports.

Provider calls start only through the retrieval or classification flow. Selected URLs go to the configured extractor; selected text, notes, and goals go to the optional model provider. Credentials are stored separately from workspace exports. Local file permissions depend on the operating system; private temporary-file permissions are checked on POSIX systems. Windows relies on the account's data-directory access controls.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** route when private reporting is available. If there is no private reporting route, open an issue requesting a private contact without including the vulnerability details. Do not post credentials, real archives, private saved text, or unredacted logs in a public issue.

Provide the affected tag or commit, operating system, a synthetic reproduction, and the impact. Use the latest published beta when available; the [release checklist](docs/RELEASE_CHECKLIST.md) records publication separately from a prepared candidate.

For maintainers: complete the source/history and artifact privacy review before changing repository visibility. Private vulnerability reporting can be enabled after the repository becomes public. Enable it then, verify that **Report a vulnerability** is available, and only afterward announce the release. If enabling or verification fails, arrange and document a working private contact route before announcement; do not ask reporters to disclose details in a public issue. See the [launch handoff](docs/LAUNCH_HANDOFF.md) for the publication sequence.


## Closed hosted implementation

The hosted API verifies Google identity, a short-lived UID/generation capability and per-workspace lifecycle. Provider credentials use server-side AES-GCM encryption with owner/provider binding and remain outside exports. Browser account switching clears private state. Production builds exclude the synthetic identity/provider fixture; never deploy `tests/*harness*` or `client/test-bootstrap.mjs`.

App suspension blocks workspace access immediately after the operation completes. Firebase revocation is checked on session renewal; ordinary access can persist for up to 15 minutes while the ID token is valid. Administrative actions and account deletion perform fresh account checks. Deletion freezes writes before provider reconciliation and retains a restricted key-repair/retry path if abort fails.

The default deployment is disabled with zero seats. Final-schema physical capacity, real Google login, live providers and platform recovery remain release gates. [Hosted operations](docs/HOSTED_OPERATIONS.md) describes incident controls, key retention and rollback limits. Synthetic tests establish implementation behavior; they do not certify deployed isolation, provider fidelity or free-platform capacity.
