# Agent workflow for the free beta

This configuration makes the production plan executable across focused tasks. It does not deploy the service or make the proposed 500-member capacity a measured guarantee.

## Repository configuration

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Project-wide constraints, invariants and verification guidance |
| `.codex/config.toml` | Enables delegation with up to three concurrent subagents, plus the coordinator |
| `.codex/agents/*.toml` | Four project-scoped agent roles |
| `.agents/skills/*/SKILL.md` | Three reusable workflows, discoverable within this checkout |
| `docs/PRODUCTION_PLAN.md` | Phase order, capacity policy, acceptance criteria and rollout evidence |

The configuration inherits the user's model, reasoning effort, tools and permissions. It does not modify personal Codex settings or enable billing. Project configuration is subject to the client's repository trust settings. A client that does not expose custom roles can still delegate their instructions explicitly.

Codex discovers repository skills under `.agents/skills`. Current custom agent definitions are standalone TOML files with `name`, `description` and `developer_instructions`. If a new skill does not appear, restart the client in this checkout. See [official skill discovery](https://developers.openai.com/codex/skills/) and [custom agent configuration](https://developers.openai.com/codex/subagents/).

These files are developer tooling in the Git checkout. They are excluded from the installable application artifacts. A package user does not need Codex to run save2ship.

## Roles and handoffs

| Role | Owns when assigned | Handoff |
| --- | --- | --- |
| Coordinator | Phase scope, shared contracts, integration, plan status and commits | Exact phase, base revision, file ownership and acceptance criteria |
| `beta_platform` | Hosted API, auth, admission, storage, quotas and jobs | API/schema changes, focused tests and capacity implications |
| `beta_product` | Browser transport, sign-in, import, library and limits UX | Observable flows, browser evidence and contract issues |
| `beta_reviewer` | Independent correctness and release-readiness review | Findings with triggers and evidence; no implementation edits |
| `beta_release` | Packaging, CI, deployment configuration and operator guidance | Reviewable artifacts, target revision, rollback and remaining evidence |

Only delegate independent work. The coordinator allocates shared files such as API types, package manifests and the plan to one writer. Review work follows the implementation it assesses. Parallel agents do not each commit a partially integrated phase.

## Skills

- `$save2ship-hosted`: implement the requested hosted phase while preserving local behaviour.
- `$save2ship-verify`: choose and execute checks appropriate to the change.
- `$save2ship-release`: prepare a release or execute a rollout that is within the authorized task.

In a Git checkout, each entrypoint is `.agents/skills/<skill-name>/SKILL.md`. Use the checkout for these files; they are deliberately absent from package archives.

Automatic selection remains enabled. Skills are workflows, not separate permission grants. For an ordinary copy change, use the relevant project guidance without loading the entire production plan.

## Example tasks

```text
Use $save2ship-hosted to execute P1 of docs/PRODUCTION_PLAN.md.
Delegate the runtime/storage prototype to beta_platform and independent
capacity review to beta_reviewer. Keep the evidence synthetic and local
until the named Cloudflare environment is available and authorized.
```

```text
Use $save2ship-verify to assess this phase against its acceptance criteria.
Run the checks that exist in the checkout. Report missing hosted or live
evidence separately from test failures.
```

```text
Use $save2ship-release to prepare the P7 release candidate.
Have beta_release assemble artifact and rollback evidence, and beta_reviewer
check the release gates. Prepare publication and rollout actions for review.
```

## Phase completion record

Update the plan with the completed phase, commit, relevant checks and evidence paths. Record remaining external setup or measurements without marking the phase complete prematurely. Use small commits with no em dashes in their messages.

For this configuration itself, validate TOML and skill YAML, resolve local links, run `git diff --check`, and forward-test the skills using representative tasks. Full application tests are required only if application or packaging behaviour changes.
