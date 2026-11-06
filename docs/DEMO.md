# A two-minute demo

Start `python3 server.py` and open http://127.0.0.1:8010/?workspace=demo. Every example is synthetic, and the personal workspace stays separate.

1. **The problem:** open Projects to see the build-only board. Open Saves to show intake and the next-step panel.
2. **The shape:** open Learning. Show topics, source previews, read-time estimates, and the Read next bookmark. Experiences has its own reading library.
3. **The action:** open a build idea. Show the read-only source beside its next action, done condition, estimate, and project assignment. Close review and use Notes on the tile to add personal context separately.
4. **The payoff:** drag a project tile from To do to In progress, then reorder within a lane. Refresh to show persistence. Demonstrate Move and This week. In Learning, read part of the indexes example, return to the library, and Continue reading. Add a takeaway separately, then Mark read. Show that it moves to Read without changing any project stage.
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

For contributor QA, run `python3 -m tests.ui_fixture` and open http://127.0.0.1:8011/. This temporary server uses three synthetic saves and mocked provider responses. Follow Process saves, enter any nonempty test token, and start retrieval. Two examples receive content (one partial); the third is gated. Organize with local rules and approve the build draft. Confirm the learning save appears in Learning without task approval. The fixture's `?workspace=demo#backlog` has a fuller sample board for checking moves, ordering, cancellation, and notes. Its `#learning` and `#experiences` routes cover libraries, topic assignment, Read next, takeaways, explicit completion, and progress after reload. Check both themes and a compact window; topics become a select beside reading-time controls. No real provider is contacted. Stop the fixture server with Ctrl+C.

For real retrieval, configure your own Apify token in the personal app and start with 10 saved links. Set a spending cap and inspect the originals, recovered text, and any partial media coverage before processing a larger run.
