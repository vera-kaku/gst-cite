# GST Cite: notes for Claude

## Writing
- Keep every claim in the README measured and reproducible; it is read by engineers evaluating the project.

## What the project does
Answers New Zealand GST questions from Inland Revenue's GST guidance (https://www.ird.govt.nz/gst). Every answer point cites source sentences and is checked against them (cited ids must exist, numbers must match, at least half the wording must be supported). A second feature tracks changes to the guidance between snapshots.

## Commands
- `npm run ingest`: crawl the guidance (about 5 minutes, 1 request every 1.5s) and save a snapshot to `data/snapshots/`. The first snapshot is the baseline for change tracking.
- `npm run eval`: run the 44 questions in `eval/questions.json`, write `eval/report.md`. `npm run eval -- --label` lists the top pages per question.
- `npm test`, `npm run typecheck`, `npm run build`, `npm start` (http://localhost:3000), `npm run dev`.
- With `ANTHROPIC_API_KEY` in `.env` the app drafts answers with the model; without it, it runs in extractive mode.

## Layout
- `src/core/chunk.ts`: extraction. Uses `contentSelector` from `config/sources.json` (`#main-content` on IRD pages), falls back to Readability. Turns accordion buttons and short bold paragraphs into headings, drops `removeSelectors` (the monthly "GST Dates" widget), keeps loose text in divs.
- `src/core/search.ts`: BM25 (MiniSearch) plus re-ranking by question coverage and heading focus. Settings in `DEFAULT_SEARCH`.
- `src/core/text.ts`: tokenising, Porter stemming with prefix matching, number and period normalisation.
- `src/core/answer.ts`: coverage check (decline before calling the model), extractive sentence choice, LLM prompt.
- `src/core/verify.ts`: citation checks. `src/core/updates.ts`: snapshot diffs.
- `test/fixtures/site.ts`: a synthetic site that imitates IRD's markup. Never copy Inland Revenue text into the repo; `data/` is git-ignored.

## Evaluation rules
- Questions marked `holdout` must not be used for tuning. Tune on the others, then report holdout results separately and honestly, even when they do not improve.
- When a change alters extraction or chunking, delete `data/` and re-ingest, otherwise change tracking reports false edits.
- Before changing labels in `eval/questions.json`, confirm against the snapshot text where the answer is.

## Status (12 October 2026)
- Done: fresh ingest with `#main-content` (snapshot `2026-10-11T11-18-02-775Z`, 71 pages, 458 passages), eval re-run, README results table updated with a third column and a note on the changed denominators. Checked against the snapshot: `records` and `pre-registration` have no answer under /gst; `correct-mistake` only says mistakes can be fixed, not how, so it stays unanswerable (see its note).
- Next: look into the `rate` regression (none of its four expected pages are in the 8 passages; the top passage is about currency conversion), run the eval in LLM mode with an API key, push to GitHub, deploy a demo, consider hybrid search with embeddings, which the holdout results suggest is the main remaining gap.
