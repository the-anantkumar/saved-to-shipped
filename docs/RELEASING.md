# Releasing the local app

The latest published free beta is **[v0.4.0b1](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1)**. Its [release record](evidence/RELEASE_0_4_0b1.md) contains the reviewed commit, CI and artifact hashes. Build future OSS releases from `main`; payment development has its own branch and is not part of this package. The runtime version is declared only in `saved_to_shipped/_version.py`.

Use this guide for the next release. Never move a published tag or replace its artifacts with a different build. The [release checklist](RELEASE_CHECKLIST.md) records completed publication and remaining work.

The release scope is a free local MIT workbench plus an optional, capacity-limited hosted beta. There is no application card requirement, trial expiry, paid tier or organization-point system. Provider keys are optional for the local demo/manual flow; extraction and AI fees remain on each user's provider accounts. Merchant onboarding and pricing are not release gates. See [free-beta scope](FREE_BETA.md) and [owner UAT](UAT.md).

## Release sequence

1. **A reproducible package.** Build a source archive and a wheel from it, validate metadata and archive contents, then install each in a fresh environment. CI runs source tests and installed-app checks on Linux, macOS, and Windows, with Linux covering Python 3.10, 3.12, and 3.14. JavaScript checks run separately.
2. **Reliable first use.** Have a new developer launch from a clean clone and a built wheel. Try the demo without keys, import a synthetic archive, organize a save, create a section inline, use the project board and reader, export, restart, and recover progress. Record the exact commit and OS. Automated install tests cover the local flow; a human setup trial is still needed.
3. **Measured enrichment.** Use the small-batch procedure in [LIVE_CHECK.md](LIVE_CHECK.md). Compare retrieved text and attachment coverage against original posts, exercise inaccessible outcomes, and record requested versus actual charges. Evaluate classification across a varied batch. Keep real examples and credentials in private local evidence, using synthetic reproductions in the repository.
4. **A deliberate release.** Finish the checks below, update the changelog and the one runtime version in `saved_to_shipped/_version.py`, build a fresh pair of artifacts, and review them before creating a version tag or publishing. Package publishing and repository visibility changes are separate release actions; the test workflow does neither.

## Build and verify locally

Use a development virtual environment with Python 3.10+; release tools are optional for ordinary application use.

```bash
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node --test tests/*_behavior.mjs
python -m build --outdir dist/candidate
python -m twine check --strict dist/candidate/*
python scripts/check_distribution.py --dist dist/candidate --install
```

Choose a fresh output directory for each candidate. The distribution check requires exactly one wheel and one source archive with matching versions. It verifies required code, browser assets, console commands, license metadata, and source-development helpers, and rejects known private/generated paths and unexpected wheel content. This is an archive boundary check, not a replacement for reviewing files for secrets.

With `--install`, the checker creates two temporary environments. Each installs one artifact and exercises console version/doctor output, all browser assets, synthetic capture/classification, inline section creation, board movement, independent reading progress, private exports, and progress after an app restart. Provider keys and the personal data directory are excluded from the child environment. Tests make no paid calls and do not touch the personal workspace.

The default `python -m build` flow builds the wheel from the source archive, so omissions cannot be hidden by the checkout. The source archive includes the synthetic screenshots under `docs/assets/`; the installed wheel contains only runtime code, its browser assets and distribution/license metadata. Hosted tooling, development agent configuration, personal data and credentials stay outside the Python artifacts. See the [PyPA packaging tutorial](https://packaging.python.org/en/latest/tutorials/packaging-projects/) and [setuptools file-selection guide](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html). Modern MIT license metadata follows [setuptools' PEP 639 support](https://setuptools.pypa.io/en/latest/userguide/pyproject_config.html).

CI retains only the verified wheel and source archive for seven days. It uses pinned official actions, read-only repository permissions, and no publication credentials. [GitHub documents artifact retention](https://github.com/actions/upload-artifact#retention-period) and [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

## Publish the reviewed local prerelease

Maintainers own repository visibility, merge/tag decisions, release creation and any package-index upload. Complete the concrete candidate checks before publication, and record the verified destination and artifacts.

1. Identify the exact candidate commit, ensure its working tree is clean, and review its source/history and artifacts for private content. The repository is already public with private vulnerability reporting enabled; verify that route before announcing another release. The package-content checker does not replace a privacy review. See [Security](../SECURITY.md).
2. Build a fresh wheel and source archive from that commit. Record both names, version, SHA-256 hashes, interpreter/OS and the successful strict metadata/content/clean-install results. CI must identify the same candidate code. Do not reuse an archive built before the final README or screenshots changed.
3. Confirm that `main` contains the reviewed candidate. Create a new version tag at that exact commit; `v0.4.0b1` is already published and must not be reused.
4. Write release notes for the new version under `docs/releases/` and create a **prerelease**. The [v0.4.0b1 notes](releases/v0.4.0b1.md) are a previous example. Attach the verified `.whl`, `.tar.gz` and a `SHA256SUMS` file. Never attach the entire `.local/` folder, personal archives, raw provider responses, credentials or authenticated browser state.
5. Verify the resulting public release URL and downloads anonymously, compare downloaded hashes, and install the downloaded wheel in an isolated environment. Update the release/checklist with those observed results rather than a planned URL.
6. PyPI is a separate destination. Verify name ownership, publishing identity and a short-lived trusted-publishing setup before uploading. Until an actual upload is verified, advertise the GitHub wheel/source route rather than an unverified `pip install saved-to-shipped` command.

The local OSS prerelease does not deploy the hosted service or admit members. Merchant onboarding and pricing are outside this release. Real provider source fidelity and charges remain limited by the evidence in [LIVE_CHECK.md](LIVE_CHECK.md); optional provider integrations must stay labeled accordingly.

## Rollback and correction

Keep the released artifacts and their hashes. If a publication is wrong, preserve the original tag/artifact record and publish a corrected version; do not silently replace an already downloaded wheel or reuse its version. Stop advertising an unsafe artifact and follow [SECURITY.md](../SECURITY.md) for coordinated reporting when applicable.

For a local application rollback, export a v1 backup first and stop the active server. Install the previous reviewed wheel in a separate environment and verify a copy of the prior workspace or backup. Do not run two versions against the same state or assume reinstalling code restores data. The current beta retains v1 backup compatibility.

A hosted rollback uses only Firestore-compatible code, its reviewed namespaces and retained encryption/session keys. Closing admission/processing, compatible-code deployment and data restoration are distinct operator steps in [HOSTED_OPERATIONS.md](HOSTED_OPERATIONS.md). A local package release does not resolve those cloud gates.

## Evidence and follow-ups

| Boundary | Publication record or remaining evidence |
| --- | --- |
| Local first use | User accepted the sample UX; a fresh-developer personal five-save trial and next-day usefulness remain separate owner UAT. |
| Package contents | The published v0.4.0b1 checks and hashes are in its [release record](evidence/RELEASE_0_4_0b1.md). Repeat them for each new candidate. |
| Automated checks | Python/shared UI/packaging CI and the applicable hosted regression checks identify their exact commit. |
| Optional retrieval/AI | Synthetic failures and earlier small live checks are documented; broad fidelity, inaccessible outcomes, actor reliability and actual charges remain limited. |
| Privacy/security | Review tracked source/history and exact uploaded artifacts; verify the private vulnerability-reporting route. |
| Public source/release | Repository and v0.4.0b1 downloads are public and verified. Record each future release's tag, URL and anonymously verified hashes. |
| Package index | Ownership and short-lived publishing identity are required before an actual PyPI upload. |
| Hosted service | Daily reservation calibration, deployed identity/recovery, metered storage/operations, a restricted cohort and rollback remain [shipping gates](SHIP_PLAN.md). |

Keep the first release LinkedIn-focused. A capped/ordered Read next shortlist, skip/replace controls, a session summary, improved attachment coverage and additional source adapters remain future work until implemented and accepted. The [free-beta scope](FREE_BETA.md) and [owner UAT](UAT.md) keep these distinctions explicit.
