---
name: save2ship-verify
description: Verify save2ship changes with relevant local, hosted, UI, or distribution checks and report evidence. Use for implementation verification or release checks, not as a mandatory full-suite step for prose edits.
---

# Save2ship verification

Read the applicable [repository instructions](../../../AGENTS.md), then inspect the diff. Use [CONTRIBUTING.md](../../../CONTRIBUTING.md) for current commands and the relevant [production-plan phase](../../../docs/PRODUCTION_PLAN.md) for hosted acceptance criteria.

## Choose checks from the changed boundary

| Change | Useful verification |
| --- | --- |
| Documentation, agent roles or skills | Resolve local links; parse changed YAML/TOML; validate skill manifests and concrete command references. Application tests are unnecessary unless runtime or packaging behaviour also changes. |
| Python domain or local HTTP behaviour | Run relevant unittest modules, then the source suite when the change crosses domain boundaries. |
| Browser behaviour | Syntax-check changed scripts, run the relevant JavaScript behaviour tests, and inspect the affected flow in the synthetic fixture when visual or interaction behaviour changes. |
| Package contents or launch paths | Build fresh wheel/source archives, validate metadata and contents, and run the installed smoke flow for both artifacts. |
| Hosted API, identity or storage | Discover the actual hosted test scripts, then exercise the affected contract with isolated identities and synthetic workspaces. |

Select a Python 3.10+ environment first, as required by `pyproject.toml`. Check its version; the system `python3` may be older. The commands below use `python` for that selected interpreter:

```bash
python -m unittest discover -s tests -v
node --test tests/*_behavior.mjs
python -m tests.ui_fixture
```

Run the fixture only when needed; it starts an ongoing server and may need a free port. Keep the user's personal server and data separate. Packaging commands and their prerequisites are maintained in [RELEASING.md](../../../docs/RELEASING.md).

## Verify meaningful hosted outcomes

When relevant to the change, cover concurrent admission at the last seat, duplicate provisioning, invalid or expired identity, forged ownership and cross-user IDs. Exercise logical/physical quota edges, failed-write rollback, index overhead, duplicate job completion and uncertain provider submission. Check that exports exclude credentials and account deletion removes retained workspace data before freeing a seat.

For imports and edits, test preservation of annotations, source provenance, grouping, board order and independent reading state. Include multibyte text in byte-limit checks. A local SQLite sizing result is not a deployed Cloudflare capacity result.

Use mocked paid providers for automated checks. Test real external calls only within an existing explicit scope and charge allowance. Inspect hosted package scripts before running them; do not invent npm commands for a directory that has not been implemented.

## Report evidence precisely

State the tested commit or working-tree scope, commands, outcomes and any environmental limits. Distinguish passed, failed and not-run checks. When a failure is caused by tooling or permissions, retain that distinction from an application defect.

After relevant checks pass, repeat or broaden testing only for a new change, failure or unresolved risk. Do not add tests that simply assert wording or mirror implementation structure.
