# Security

Save2Ship is a personal application for a trusted local computer. It binds to IPv4 loopback, validates Host headers, and requires a per-run token for writes. It has no shared-user authentication or public-hosting boundary. Keep personal archives, workspace backups, and provider credentials out of source control and public reports.

Provider calls start only through the retrieval or classification flow. Selected URLs go to the configured extractor; selected text, notes, and goals go to the optional model provider. Credentials are stored separately from workspace exports. Local file permissions depend on the operating system; private temporary-file permissions are checked on POSIX systems. Windows relies on the account's data-directory access controls.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** route when private reporting is available. If there is no private reporting route, open an issue requesting a private contact without including the vulnerability details. Do not post credentials, real archives, private saved text, or unredacted logs in a public issue.

Provide the affected commit or version, operating system, a synthetic reproduction, and the impact. Development is currently on `main`; no stable supported package release has been published. Enable and verify private vulnerability reporting before making the repository public.
