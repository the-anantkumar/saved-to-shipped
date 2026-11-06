# Live check, 6 November 2026

This is a development check on one person's LinkedIn archive, not a guarantee of coverage for other accounts. Private inputs, post bodies, provider responses, exports, and keys stay outside Git.

## Observed results

- A completed ten-post run from the configured Apify actor matched ten saved links in the imported archive by source identifiers. All ten supplied nonempty text and author metadata.
- Five results were marked extracted and five partial. Partial means the post text was recovered but media or attachment content was incomplete. No complete image, video, or document recovery is claimed.
- Live OpenAI classification succeeded for all ten readable saves. A second pass, after instruction changes, produced nine learning drafts and one reference draft in six topic groups. Every draft has a first action, done condition, and estimate. All remain in the inbox for review.
- The first pass over-fragmented groups and mistook third-party interview reports for personal experiences. Instructions now define the categories, preserve source authorship, encourage reusable groups and small first actions, and pass partial/truncated coverage to the model. Grouping and task quality still need human review.
- A later hosted submission timed out before returning a run reference. The app retained an uncertain job and blocked another submission. An authenticated check of recent actor runs showed only the earlier completed run. The uncertain job was explicitly dismissed; no automatic paid retry was made. Existing cached content was used for the AI check.
- A real workspace export preserved source content and annotations and contained no configured provider keys. The restarted browser showed the six groups and the completed retrieval status. All 60 regression tests passed.

## Remaining checks

- Compare recovered text and attachment fidelity with the original LinkedIn pages.
- Exercise inaccessible, deleted, and gated posts against the live provider. Those cases have synthetic regression coverage.
- Reconcile the provider's complete billed amount and charge-cap behavior. The run's reported usage field alone is not an invoice total.
- Check submission reliability from a fresh developer environment. A successful cached dataset does not establish that every new submission will succeed.
- Evaluate grouping across larger, varied batches and complete an independent developer setup trial before publication.

No archive-wide paid run, issue publication, or automatic task acceptance was part of this check.
