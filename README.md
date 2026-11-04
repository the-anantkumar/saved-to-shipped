# Saved → Shipped

**Your LinkedIn saves should become experiments, useful knowledge, real-life experiences, and GitHub commits—not another graveyard of bookmarks.**

This is a local-first, multi-platform project for Anant. It imports the *official* LinkedIn `Saved_Items.csv` or the ZIP archive containing it, accepts a user-provided Reddit saved-listing JSON, and supports Instagram/other platforms through a normalized CSV/JSON manifest. It maintains a deduplicated backlog, asks ChatGPT to classify only items with actual context, and generates a weekly sprint plus draft GitHub issues.

No dependencies beyond Python 3.10+. No scraping, site credentials, cookies, or posting permissions.

## The first run

1. On LinkedIn desktop, open **Settings & Privacy → Data Privacy → Download your data**, request an archive with **Saved Items**, and download the ZIP when LinkedIn emails you. [Official instructions](https://www.linkedin.com/help/linkedin/answer/a1341346).
2. Run the importer from this folder:

   ```bash
   python3 saved_to_shipped.py ingest /path/to/LinkedInDataExport.zip
   python3 saved_to_shipped.py list
   ```

   LinkedIn is the default adapter. To import data from other sources, see **More platforms** below.

3. LinkedIn's export supplies **dates and URLs, not the bodies of other people's posts**. Open a promising saved link yourself and save relevant text to a local `.txt` file. Then attach it to the corresponding item ID:

   ```bash
   python3 saved_to_shipped.py attach 012345abcdef --title "Agent memory pattern" --content-file /path/to/post.txt --note "Could help TRLR evaluation"
   ```

   Replace the illustrative ID with the real ID from `list`. Instead of full post text, a substantive note describing the idea works. You can also share screenshots/post text with ChatGPT directly and have it help you prepare annotations.

4. Generate a prompt for ChatGPT:

   ```bash
   python3 saved_to_shipped.py prompt
   ```

   Paste the contents of `output/triage_prompt.md` into ChatGPT. Ask for a downloadable `triage.json` containing **only the JSON response**. The prompt includes only posts with real supplied context, and lists unknown posts separately.

5. Apply that response, then make your sprint and GitHub issue drafts:

   ```bash
   python3 saved_to_shipped.py apply /path/to/triage.json
   python3 saved_to_shipped.py plan --hours 6
   python3 saved_to_shipped.py issues
   ```

   Read `output/weekly_sprint.md` and the files under `output/issues/`. Issues are **draft files**, not published to GitHub.

6. Once you've shipped the task, update the item:

   ```bash
   python3 saved_to_shipped.py status 012345abcdef done
   ```

Re-import the latest archive any time. Previously triaged items and annotations remain intact. The new imports will be deduplicated.

## More platforms

Every import adapter converts its source into the same `ImportedSave` shape: `platform`, `url`, `saved_at`, `external_id`, `title`, `content`, `author`, and `metadata`. The triage, scoring and sprint stages do not know or care which platform produced an item.

| Source | Input | Command |
| --- | --- | --- |
| LinkedIn | Official `Saved_Items.csv` or data ZIP | `python3 saved_to_shipped.py ingest export.zip` |
| Reddit | User-provided authenticated saved-listing JSON | `python3 saved_to_shipped.py ingest reddit.json --adapter reddit` |
| Instagram | Normalized CSV/JSON manifest prepared by the user | `python3 saved_to_shipped.py ingest instagram.csv --adapter instagram` |
| Any source | Normalized CSV/JSON with a `platform` column | `python3 saved_to_shipped.py ingest saves.json --adapter manifest` |

### Normalized manifest format

```csv
platform,url,saved_at,title,content,author
instagram,https://www.instagram.com/p/EXAMPLE/,2026-11-01,Design idea,A short personal description,creator
reddit,https://www.reddit.com/r/example/comments/EXAMPLE/,2026-11-02,Useful thread,My notes about it,contributor
```

Use actual links and text when working with your own saves; the rows above are illustrative placeholders.

JSON can be either an array or `{ "items": [ ... ] }` with the same field names. An optional `external_id` can hold the original provider's item identifier. Missing content is okay: the workflow marks it as needing context.

### Reddit input detail

The Reddit adapter accepts a JSON `Listing` with `data.children` from the documented `/user/{username}/saved` endpoint, supplied by you through an authorized process. It supports saved posts and comments. The Reddit `created_utc` field is the *publication date*, **not the date you saved it**; this distinction is preserved.

This version does not perform OAuth. Reddit Data API access is subject to developer approval, restrictions and rate limits, and Reddit's Devvit platform does not expose a user's private saved list. A local JSON import keeps the core functionality separate from those permissions.

### Instagram input detail

`--adapter instagram` accepts the normalized manifest above; it **does not yet parse arbitrary Instagram account archives or access saved collections automatically**. A future `sources/instagram.py` can implement an officially supported export format once tested against a real, permitted sample.

### Add another adapter

1. Create `sources/newplatform.py` with a function `parse_newplatform(path: Path) -> list[ImportedSave]`.
2. Register it in `sources/registry.py`.
3. Add fixtures and tests for empty exports, duplicate URLs, deleted content, and malformed files.
4. Document where the user gets their data and any platform-specific permissions.

No changes to the triage, scoring or GitHub draft code should be needed.

## The ChatGPT-only route (no terminal required)

Create a ChatGPT Project called **Saved → Shipped** and paste [CHATGPT_PROJECT_INSTRUCTIONS.md](CHATGPT_PROJECT_INSTRUCTIONS.md) into its instructions. Upload your LinkedIn archive ZIP. ChatGPT can analyze the URL/date manifest, identify which posts need more content, organize manually supplied text/screenshots, and make a weekly sprint. The Python tool is optional; it is for durable, reproducible local bookkeeping and issue generation.

## The queues

| Queue | Example | Concrete output |
| --- | --- | --- |
| Build | A useful MCP pattern | A 1–2 hour feature, test, README example, commit |
| Learn | A retrieval evaluation guide | Five-line summary + a tiny reproducible experiment |
| Experience | Interesting hackathon | Entry/registration research and a personal decision |
| Reference | Useful article, not urgent | A tagged link with a one-line explanation |
| Skip | Unsubstantiated hype | Archived with no guilt |

We favor *small completed tasks* instead of inflated commit counts. The `effort_hours` field measures the **first atomic next action**, not the entire project.

## Boundaries

- A saved URL does not reveal what the post says. Don't classify it on the basis of a suggestive slug alone.
- Some posts are private, removed, paywalled, or inaccessible to ChatGPT's browsing tools. Copy or describe only the material you're comfortable analyzing.
- LinkedIn [prohibits third-party scraping and automating its site](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions). This project does not access LinkedIn automatically. Other source adapters likewise read local files only.
- Your `data/` and `output/` folders are gitignored. They can contain personal data or post excerpts. Review issue drafts before publishing; avoid publishing proprietary or copyrighted post text.
- The utility scores are suggestions, not measurements of your potential. You choose what gets built.

## Roadmap

- **v0.2 (this package):** platform adapters, LinkedIn archive, Reddit saved-listing JSON, Instagram/generic manifests, dedupe, ChatGPT triage, sprint, local issue drafts.
- **v0.3:** batch context capture from user-provided PDFs/screenshots; source links and evidence status; better duplicate-topic clustering.
- **v0.4:** approve-to-create GitHub issues in a chosen repo; link actual commits/PRs to saved ideas.
- **v1:** weekly review, feedback from finished work, and optional reminders after you choose a schedule.

## Development

```bash
python3 -m unittest discover -s tests -v
python3 saved_to_shipped.py --help
```

The program is one Python standard-library file. You can extend it into a GitHub project or a ChatGPT connected workflow without a new dependency tree.
