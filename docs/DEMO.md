# A two-minute demo

Start `python3 server.py` and open http://127.0.0.1:8010/?workspace=demo. Every example is synthetic, and the personal workspace stays separate.

1. **The problem:** open Board to see organized sample ideas. Open Saves to show the next-step panel and the To review, All saves, and Waiting filters.
2. **The shape:** open Projects. Follow a group to its related saves.
3. **The action:** open a build idea. Show the read-only source beside its next action, done condition, estimate, and project assignment. Close review and use Notes on the tile to add personal context separately.
4. **The payoff:** drag a tile from To do to In progress, then reorder two tiles within a lane. Refresh to show persistence. Demonstrate the Move control as an alternative. Open the This week tab within Board and change the time budget.
5. **The handoff:** use Export in the top bar. Explain that this produces local sprint and issue drafts, with the original inspiration link kept attached.
6. **The result:** open the task again, add a real result URL only if you actually completed the work, and move it to Done. Synthetic example statuses illustrate the interface, not actual shipped work.

For the import demonstration, use **Import archive → Download a synthetic test ZIP**, then import that file into the demo. Import again to show deduplication. Those links already exist in the seeded workspace, so both rows are reported as duplicates.

To demonstrate classification, find an item under Waiting and open its Notes editor. Add a note such as “Build a small Python script that totals my expense categories from a CSV,” and save. Choose **Organize saves → Organize with local rules**. If AI is configured, local rules are under Other ways to organize. Choose **Start reviewing**, inspect the draft, and **Add to backlog**, or move the draft from Review to To do on the board. Explain that local rules are heuristics; optional AI is a different mode.

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

For contributor QA, run `python3 -m tests.ui_fixture` and open http://127.0.0.1:8011/. This temporary server uses three synthetic saves and mocked provider responses. Follow Process saves, enter any nonempty test token, and start retrieval. Two examples receive content (one partial); the third is gated. Organize with local rules, approve the first draft, and park the second. Confirm that review advances automatically and finishes on the board. The fixture's `?workspace=demo#backlog` has a fuller sample board for testing cross-lane moves, reordering, dropping outside a lane, the Move control, independent notes, and refresh persistence. No real provider is contacted. Stop the fixture server with Ctrl+C.

For real retrieval, configure your own Apify token in the personal app and start with 10 saved links. Set a spending cap and inspect the originals, recovered text, and any partial media coverage before processing a larger run.
