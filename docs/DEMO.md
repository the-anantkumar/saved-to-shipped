# A two-minute demo

Start `python3 server.py` and open http://127.0.0.1:8010/?workspace=demo. Every example is synthetic, and the personal workspace stays separate.

1. **The problem:** show the saved inbox. Ideas are collected, grouped, and visibly waiting for context where needed.
2. **The shape:** open Projects. Follow a group to its related saves.
3. **The action:** open a ready build idea. Show the supplied context, suggested first action, done condition, estimate, and project assignment. Edit the task to make it specific, and change its status to In progress.
4. **The payoff:** open Backlog and show that task in its new column. Open This week and change the time budget.
5. **The handoff:** export the sprint and issue drafts. Explain that this produces local files, with the original inspiration link kept attached.
6. **The result:** open the task again, add a real result URL only if you actually completed the work, and mark it Shipped. Synthetic example statuses illustrate the interface, not actual shipped work.

For the import demonstration, use **Import archive → Download a synthetic test ZIP**, then import that file into the demo. Import again to show deduplication. Those links already exist in the seeded workspace, so both rows are reported as duplicates.

To demonstrate classification, open one of the two saves marked Needs context, add a note such as “Build a small Python script that totals my expense categories from a CSV,” and save. Choose **Review classification options → Suggest directions locally**. Review the new draft and set its status to Ready. Explain that local rules are heuristics; optional AI is a different mode.

When presenting the project, say that LinkedIn archives contain URLs and saved dates. Post context comes from explicitly requested hosted retrieval or user-supplied text and notes. Do not demonstrate synthetic content as a scraped live feed. The [live check](LIVE_CHECK.md) records the real-data evidence and remaining limits.

## Real-data smoke test when the archive arrives

- Import the ZIP into the personal workspace. Confirm the row count and a few source links against Saved_Items.csv.
- Add a note to one item, classify/review it, assign a project, and set it Ready.
- Import the same ZIP again. Confirm zero new items and preserved edits/status.
- Restart the server. Confirm data still appears.
- Download an export and check the selected task, project name, and inspiration link.
- If using OpenAI, configure your own key and classify a small new batch. Confirm incomplete/URL-only items are excluded.

Avoid showing your real archive contents, notes, or API key in a public screen recording.

## Hosted retrieval without provider charges

For contributor QA, run `python3 -m tests.ui_fixture` and open http://127.0.0.1:8011/. This temporary server uses synthetic saves and mocked provider responses. Add any nonempty test token in Settings, choose Process saves, and start a run. One example receives content and another is marked as gated. Classify the recovered example using local suggestions. No real provider is contacted. Stop the fixture server with Ctrl+C.

For real retrieval, configure your own Apify token in the personal app and start with 10 saved links. Set a spending cap and inspect the originals, recovered text, and any partial media coverage before processing a larger run.
