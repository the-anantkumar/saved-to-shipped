# Optional agent tooling

The repository includes Codex roles and skills for contributors who use agents. They are development tools, excluded from the application packages. Running Saved to Shipped does not require Codex.

Start with [AGENTS.md](../AGENTS.md) for project constraints and verification rules. Hosted work also follows the [production plan](PRODUCTION_PLAN.md); the [contribution guide](../CONTRIBUTING.md) covers branches and pull requests.

## Configuration

[`.codex/config.toml`](../.codex/config.toml) enables delegation with up to three concurrent subagents. Roles live in `.codex/agents/`; each TOML file defines `name`, `description` and `developer_instructions`. Skills live in `.agents/skills/`, with a `SKILL.md` entrypoint and an `agents/openai.yaml` interface definition.

The configuration inherits the user's model, reasoning effort, tools and permissions. It does not change personal settings or authorize deployments, billing or provider calls. Repository trust settings still apply. If a skill is not discovered, restart the client in the checkout. See the official [skills](https://developers.openai.com/codex/skills/) and [subagents](https://developers.openai.com/codex/subagents/) documentation for client setup.

## Roles

| Role | Responsibility |
| --- | --- |
| Coordinator | Scope, file ownership, shared contracts, integration and commits. |
| `beta_platform` | Hosted API, identity, admission, storage, quotas and jobs. |
| `beta_product` | Browser transport, sign-in, import, libraries and usage-limit UI. |
| `beta_reviewer` | Independent review with reproducible findings; does not edit the implementation being reviewed. |
| `beta_release` | Packaging, CI, deployment configuration and rollback instructions. |

Give each implementation task a clear base revision, owned files and acceptance criteria. Assign shared files to one writer. Review the integrated change before committing; each handoff should list changed files, checks and remaining limitations.

## Skills

- [save2ship-hosted](../.agents/skills/save2ship-hosted/SKILL.md): implement a scoped hosted change while preserving local behavior.
- [save2ship-verify](../.agents/skills/save2ship-verify/SKILL.md): choose relevant checks and report their results.
- [save2ship-release](../.agents/skills/save2ship-release/SKILL.md): prepare artifacts or carry out an already authorized release.

Invoke a skill by name, such as `$save2ship-verify`; automatic selection is also enabled. Skills guide the work but do not grant extra permissions.

When changing this tooling, validate TOML/YAML, local links and whitespace, then check the changed role or skill on a representative task. Application tests are needed when application or packaging behavior changes, not for prose alone.
