# save2ship acceptance testing

Use this pass to decide whether importing, organizing and returning to saved ideas feels ready. Automated acceptance is recorded separately from your sign-off. This environment runs the hosted application on local Cloudflare tooling with synthetic identities and mocked providers. It does not validate real Google sign-in, LinkedIn retrieval quality or deployed free-tier capacity.

## Start with one command

From `hosted/`, use Node 24 and npm 10 or 11. Install the locked tooling once with `npm ci`, then:

```sh
npm run uat
```

Open the loopback URL printed by the command. No cloud account or provider key is needed. The banner must say **Synthetic UAT**. Use synthetic content and dummy keys only. All edits belong to a temporary test workspace; Ctrl+C stops it, and restarting the command creates fresh examples. This fixture is not a deployment target.

The test-account controls offer:

| Account | Starting point |
| --- | --- |
| Alice | Three examples, one each in Projects, Learning and Experiences, with dummy provider keys |
| Bob | An empty workspace for the first-use flow |
| Charlie | The beta-full screen while Alice and Bob occupy both test seats |

Selection and sign-out persist across reloads in that browser. A separate browser starts independently. To compare two sessions of Alice, choose Alice in each. Signing out also clears other tabs in the same browser, as persistent authentication would. Deleting a test account frees its seat; restart the command to reset that scenario.

## Acceptance checklist

Mark each row Pass or Fail and note any confusing step. Agent-run checks do not replace the product owner's judgment about clarity and usefulness.

| Journey | Action and expected result | Your result |
| --- | --- | --- |
| First use | Choose Bob. Import the synthetic ZIP available in the import dialog. Preview the count, confirm, then import it again. The original saves remain without duplicates. | Pending |
| Processing | In Bob's Settings, save dummy Apify/OpenAI keys. Saving keys does not start work. Explicitly retrieve content and organize it. Mocked jobs finish and their results appear. | Pending |
| Projects | Choose Alice. Move the project between To do, In progress and Done using drag or the Move menu. Text elsewhere must not select. Reload and confirm the saved position. | Pending |
| Learning | Open Learning. Use reading time, topic and status filters. Open a read, scroll, return, queue it and mark it read. Reading progress stays separate from project status. | Pending |
| Experiences | Open Experiences. Only the experience example appears. Open it and return without losing its place. | Pending |
| Notes and search | Edit the Learning note. Search for `quasarneedle`, reload, and repeat. The same save appears without opening Notes first. Original post text remains unchanged. | Pending |
| Organizing | While organizing a save, create a project/topic/section from the dropdown. The entered title and other draft fields remain intact. | Pending |
| Two sessions | Open Alice in another browser. Edit a save there and return to the first. It refreshes when no draft is open. If both edit the same note, the stale save reports a conflict and preserves the unsaved draft. | Pending |
| Backup | Export Alice's backup. Restore it in Bob, then repeat the restore. Notes, source, grouping and reading state survive; keys are absent and duplicate saves are skipped. | Pending |
| Sessions | Sign out and reload. Private content stays hidden. Choose Bob and reload; Alice's saves never appear. Choose Charlie to inspect the full-beta message. | Pending |
| Comfort | Try dark mode, a narrow viewport and keyboard-only navigation. Controls remain readable, focused and reachable. | Pending |
| Deletion | Export first, then delete a test workspace. It becomes inaccessible and another test identity can use the released seat. | Pending |

If something fails, record the account, screen, action, expected result and actual result. Do not attach real archives, tokens or private source content to a public issue. A screenshot of this synthetic fixture is suitable for a review after checking it contains only test content.

## Automated checks and shipping boundary

The [2026-11-15 product audit](evidence/PRODUCT_AUDIT.md) completed a synthetic first-use journey and identified three unresolved trust issues: queuing an unopened read can leave its reader visibly empty until reload, a new empty topic is hidden, and the weekly time budget resets on reload. Reproduce and resolve these before owner acceptance. Existing broad end-to-end checks do not cover the queue-before-open order that exposed the reader issue.

For the next product pass, choose five relevant saves rather than processing an entire archive. Complete one read with a takeaway or one project action, then return the next day without instructions. Check whether continuing useful work takes less effort than reopening LinkedIn Saved Items. The audit contains the detailed delivery order and proposed acceptance targets; those targets are not measured results.

`npm run test:e2e` runs the application journeys; `npm run test:uat` runs the visible test-account controls, reload/sign-out behavior, token renewal and mobile/dark layout. Both use only generated identities and mocked providers. Reports live in ignored `hosted/.local/` directories.

See the [UAT development evidence](evidence/UAT.md) for the tested checkpoint and findings. User sign-off is pending until the checklist is exercised and accepted. Real Google authentication, authorized bounded provider calls, final cloud storage/CPU accounting and deployed rollback remain separate gates in the [shipping plan](SHIP_PLAN.md). Passing this local UAT must not be presented as proof that the hosted beta supports 500 members.
