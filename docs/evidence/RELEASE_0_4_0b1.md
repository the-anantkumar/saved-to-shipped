# Saved to Shipped v0.4.0b1 release evidence

Record date: 2026-11-17. The free local MIT beta is published at [GitHub Releases](https://github.com/the-anantkumar/saved-to-shipped/releases/tag/v0.4.0b1). The [source repository](https://github.com/the-anantkumar/saved-to-shipped) is public. PyPI and public hosted admission are separate and were not enabled by this release.

## Reviewed source and integration

| Record | Value |
| --- | --- |
| Clean release candidate/tag target | `a559445856b9a5bf3b805c1d1b7f47bb856a7f5a` |
| Main merge of MR 10 | `1a9bd810285d3854f643eb3fe4cf9475b614e0e7` |
| Tree comparison | Candidate and main merge have identical trees. |
| Retrieval approval fix | `136c14c` |
| Product polish/draft protection | `aa3da95` |
| Release tag | `v0.4.0b1` |
| Python runtime version | `0.4.0b1` |

[MR 10](https://github.com/the-anantkumar/saved-to-shipped/pull/10) is merged. The inherited foundation remains in history; superseded PR 8 was closed, and GitHub marked PRs 7/9 merged through ancestry. The final beta tree excludes paid runtime/UI despite that historical ancestry. The paid prototype remains a preserved checkpoint, not a feature of the published local app.

## CI and review

Both workflows passed for the release candidate:

- [Tests](https://github.com/the-anantkumar/saved-to-shipped/actions/runs/43945755992): Python matrix, shared browser behavior and package/clean-install checks.
- [Hosted workbench](https://github.com/the-anantkumar/saved-to-shipped/actions/runs/43945755978): backend, emulator/browser checks and closed production artifact boundaries.

The scoped product checks recorded in [Product polish](PRODUCT_POLISH.md) include 91 Python tests, 36 shared JavaScript tests, five local/shared browser interactions and the existing hosted acceptance groups. Independent review closed the selected-URL and late-poll draft-loss defects. Independent artifact/history/privacy review passed. No live paid provider request was part of this release verification.

The coordinator checked issue/contribution/license material and 122 candidate relative links. A clean production boundary report checked ten assets; it does not establish a public hosted deployment or measured cohort.

## Published artifacts

The GitHub prerelease contains the wheel, source archive and `SHA256SUMS`. The wheel was built through the source-distribution path. Both artifact formats passed strict metadata/content validation and clean-environment installation, organizing/reading/export and restart checks.

| Artifact | SHA-256 |
| --- | --- |
| `saved_to_shipped-0.4.0b1-py3-none-any.whl` | `f9e8bf67f8c2dfff315dff4fd4ffd72f967c594e30c048ad669dc9849618a096` |
| `saved_to_shipped-0.4.0b1.tar.gz` | `654150eb38bbe90cb3fd907360a4d871652c2146afbdb4f762e358a132d34957` |

All three assets were downloaded anonymously from the public release. Wheel/source hashes matched the reviewed files and checksum manifest. The downloaded wheel and source archive then each passed the distribution check's independent clean install and restart flow. The anonymous release page, main README, desktop/mobile images and tagged usage guide returned HTTP 200; checked content hashes matched local copies.

These immutable release artifacts remain tied to the candidate commit above. Later documentation/status commits do not replace the published tag or those files.

## Private reporting and remaining work

After the repository became public, private vulnerability reporting was enabled. The API returned `enabled: true`; the anonymous new-advisory route redirected to GitHub sign-in as expected. Private reporting is available through [Security](../../SECURITY.md); no credentials, raw authenticated state or personal content were attached to release evidence.

The owner accepted the synthetic preview. Personal five-save/next-day usefulness feedback, optional PyPI publishing, and the existing hosted free-tier calibration, deployment/recovery and measured-cohort checks remain open. Public hosted admission stays closed at zero seats. The local app needs no cloud account or subscription. [Launch handoff](../LAUNCH_HANDOFF.md) lists only remaining work; [the checklist](../RELEASE_CHECKLIST.md) records completed and open items.
