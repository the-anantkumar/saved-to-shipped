# Preparing the first open-source release

The approved organizing experience is preserved by `checkpoint/organizing-ux-2026-11-07` at `5f84ee3`, merged to main in [PR #5](https://github.com/the-anantkumar/saved-to-shipped/pull/5). Further work starts from that merge on `feat/oss-release-readiness`. The repository is currently private and no package has been published to PyPI.

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

The default `python -m build` flow builds the wheel from the source archive, so omissions cannot be hidden by the checkout. See the [PyPA packaging tutorial](https://packaging.python.org/en/latest/tutorials/packaging-projects/) and [setuptools file-selection guide](https://setuptools.pypa.io/en/latest/userguide/miscellaneous.html). Modern MIT license metadata follows [setuptools' PEP 639 support](https://setuptools.pypa.io/en/latest/userguide/pyproject_config.html).

CI retains only the verified wheel and source archive for seven days. It uses pinned official actions, read-only repository permissions, and no publication credentials. [GitHub documents artifact retention](https://github.com/actions/upload-artifact#retention-period) and [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

## Evidence still required before publication

| Check | Current evidence | Remaining work |
| --- | --- | --- |
| Official archive import | A real 482-save export imported and re-imported without losing annotations | Fresh-developer trial on the intended release commit |
| Local organizing | Synthetic HTTP/UI tests and browser QA cover all three destinations | Human empty-workspace and mobile review |
| Installed package | Wheel and source-archive checks, including restart persistence | Confirm CI passes for the final candidate |
| Hosted post retrieval | Ten real results matched saved URLs; coverage limits are recorded | Compare source fidelity, unavailable outcomes, actor reliability, account limits, and actual billing |
| Classification | A small live optional-model batch produced grouped drafts | Review learning/project/experience accuracy across varied saves |
| Privacy and reporting | Private settings, export exclusions, archive path checks, and SECURITY.md | Review tracked files/history and verify a private vulnerability-reporting route |
| Publication | No package or public repository release yet | Choose release version, package-index ownership, audience, and release notes after the checks |

## Refinement and enrichment backlog

- Make empty-workspace organization useful before provider configuration, and test the full first-use journey with a new developer.
- Preserve source identity and provenance when importing an existing extractor dataset, so developers can reuse content without another paid run.
- Improve attachment and linked-article coverage only through tested adapters, with visible missing/truncated content and explicit paid work.
- Improve classification boundaries and topic naming from reviewed examples before introducing automatic regrouping or additional sources.

Stay LinkedIn-focused for the first release. Add one tested enrichment capability at a time, keeping the checkpoint and phased commits available for backtracking.
