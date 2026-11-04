"""Synthetic examples for a reproducible demo, never represented as real posts."""

from saved_to_shipped import new_item


EXAMPLES = [
    ("Give an AI agent a memory that lasts", "A small experiment: build persistent agent memory with SQLite. Store conversation summaries and retrieve relevant context. Compare answers with and without memory.", "AI playground"),
    ("A better way to evaluate RAG", "Build a retrieval evaluation harness with ten questions and known answers. Measure retrieval precision before changing chunk size or embeddings.", "AI playground"),
    ("Your first MCP tool, minus the magic", "Build one MCP tool that searches a local notes folder. Start with a command line proof of concept and verify that a matching note is returned.", "AI playground"),
    ("The bookmark graveyard is real", "Build a personal bookmark dashboard. Import a CSV, group saved links by project, and pick a single next action. Keep all storage local.", "Personal tools"),
    ("Ship the boring automation", "Automate a weekly expenses report from a local CSV using Python. Start by totaling categories and export a Markdown summary.", "Personal tools"),
    ("A tiny API worth building", "Build a quote capture API backed by SQLite. The first slice is a POST endpoint and a test that reads the saved quote back.", "Personal tools"),
    ("Understanding database indexes", "Learn how a database index changes query execution. Run EXPLAIN on one query before and after creating an index and write down the result.", "Learning lab"),
    ("Small experiments beat long reading lists", "A tutorial on testing prompts with a fixed dataset. Learn by running three prompt variants against five examples and documenting failure cases.", "Learning lab"),
    ("Find your next builder weekend", "A fictional community hackathon invitation. Research dates and entry requirements before deciding whether to attend. This is sample content, not a live event.", ""),
    ("A reference for accessible forms", "A reference checklist for accessible forms: visible labels, useful error messages, keyboard navigation, and focus management. Keep for the next UI review.", ""),
    ("An idea still waiting for context", "", ""),
    ("Another save to revisit", "", ""),
]


def demo_state() -> dict:
    items = []
    for index, (title, content, project) in enumerate(EXAMPLES, start=1):
        item = new_item(f"https://www.linkedin.com/feed/update/urn:li:activity:900000000000000{index:03d}",
                        f"2026-10-{30 - index:02d}", title=title, content=content,
                        author="Synthetic demo", metadata={"synthetic": True})
        item["suggested_project"] = project
        items.append(item)
    return {"version": 1, "items": items, "projects": [], "imports": [], "demo": True}
