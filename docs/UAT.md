# save2ship acceptance testing

Use this pass to decide whether a few saved ideas become useful with little effort. The [free beta](FREE_BETA.md) needs no application card, subscription or expiry countdown. The owner accepted the synthetic preview before requesting release. The real five-save and next-day trial below remains a separate acceptance record; automated checks do not fill in those outcomes. Track the complete release in the [release checklist](RELEASE_CHECKLIST.md).

## Owner trial with no cloud setup

Run `python3 server.py` from the checkout with Python 3.10+. Start with the separate [synthetic demo](http://127.0.0.1:8010/?workspace=demo) to learn the controls without accounts or keys. Then use the normal local workspace for the personal trial below. Provider retrieval/AI is optional; manual pasted source text and local rules are available.

| Session | Action and outcome | Owner result |
| --- | --- | --- |
| Day 1: choose | Import your archive once, then pick five saves relevant to a current goal. Inspect the URLs; leave the rest dormant. If needed, paste source text or explicitly retrieve only those saves with your own provider key and charge cap. | Pending |
| Day 1: organize | Put the five saves into Projects, Learning or Experiences. Create an empty section and confirm it stays visible. Save your weekly time preference and reload. | Pending |
| Day 1: finish | Complete one read with a takeaway, or advance one small project action. Confirm source text is still visible and notes are separate. Stop after that outcome; no backlog-clearing target is required. | Pending |
| Day 1: recover | Export a backup, stop and restart the application, then reopen the same workspace. Notes, groups, reading progress and weekly preference remain. | Pending |
| Day 2: return | Open the app without instructions. Use Today to continue useful work, or Find a saved idea to locate a note. Record what was confusing and whether this took less effort than LinkedIn Saved Items. | Pending |
| Comfort | Repeat the useful action in dark mode, at a narrow width and with the keyboard. There is no upgrade, checkout or credit-balance task in this trial. | Pending |

Keep real archives and notes private. Record time-to-first-useful-outcome and time-to-find-a-continuation as observations, not pre-filled success claims. A three-choice Read next cap, skip/replace controls and a completed-session summary are not claimed as implemented by this checklist.

## Optional hosted account trial

If cross-device persistence is part of your acceptance, use the [Firebase setup](FIREBASE_SETUP.md) and only the admitted test accounts. Check Google sign-in or verified Email/password plus authenticator TOTP, sign out/reload, reopen in another browser, confirm private data isolation and export before deletion. This path uses real Firebase identity/storage. It still needs no merchant account, payment setup or subscription. Real provider calls remain separately explicit and use your own accounts.

## Synthetic hosted regression environment

The following fixture runs the hosted application on local Cloudflare tooling with synthetic identities and mocked providers. It does not validate real sign-in, LinkedIn retrieval quality or deployed free-tier capacity.

### Start the synthetic environment

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

### Synthetic regression checklist

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

The [2026-11-15 product audit](evidence/PRODUCT_AUDIT.md) identified the queue-before-open reader, hidden empty section and forgotten weekly-budget issues. [Historical refinement evidence](evidence/PRODUCT_REFINEMENTS.md) records their fixes. Recheck those exact behaviors on this separated candidate; [free-beta evidence](evidence/FREE_BETA.md) records its new results rather than inheriting old payment-branch passes.

For the next product pass, choose five relevant saves rather than processing an entire archive. Complete one read with a takeaway or one project action, then return the next day without instructions. Check whether continuing useful work takes less effort than reopening LinkedIn Saved Items. The audit contains the detailed delivery order and proposed acceptance targets; those targets are not measured results.

`npm run test:e2e` runs the application journeys; `npm run test:uat` runs the visible test-account controls, reload/sign-out behavior, token renewal and mobile/dark layout; `npm run test:product` checks Today, sections, preferences and deliberate retrieval. These use generated identities and mocked providers. Reports live in ignored `hosted/.local/` directories.

See the [UAT development evidence](evidence/UAT.md) for the tested checkpoint and findings. User sign-off is pending until the checklist is exercised and accepted. Real Google authentication, authorized bounded provider calls, final cloud storage/CPU accounting and deployed rollback remain separate gates in the [shipping plan](SHIP_PLAN.md). Passing this local UAT must not be presented as proof that the hosted beta supports 500 members.
