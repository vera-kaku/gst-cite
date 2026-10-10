# GST Cite

Answers questions about New Zealand GST from Inland Revenue's published guidance, and shows the exact sentence behind every point. It also keeps a copy of the guidance each time it runs and reports what changed since the last run.

Tax answers are only useful if they are right, so the main design goal is that nothing reaches the reader unless it can be traced to a sentence in the guidance.

## What it does

**Ask a question.** Type a GST question in plain English. The answer comes back as short points. Each point has numbered citations, and the sources panel shows the cited sentence with a link that opens the guidance page scrolled to that sentence. Figures (amounts, rates, dates) are highlighted in both the answer and the source so they can be compared at a glance.

**Guidance changes.** Every ingest run saves a snapshot of the guidance. The next run compares page by page and lists new pages, removed pages and changed wording, shown as a before and after diff. With a model configured, each change also gets a short summary of what changed and who it might affect, and those summaries go through the same checks as answers.

## How an answer is checked

```
question
   │
   ▼
keyword search (BM25) over passages ──► top 8 passages, every sentence given an id
   │
   ▼
model drafts points as JSON, each citing sentence ids
   │
   ▼
checker, per point:
   1. every cited id must be one of the sentences the model was shown
   2. every number in the point must appear in the cited sentences
   3. at least half of the point's content words must appear in the cited sentences
   │
   ├── passes ──► shown with its citations
   └── fails  ──► removed, and listed under "points removed" with the reason
```

If no point passes, the app says the guidance it has indexed does not answer the question rather than showing an unsupported answer. The model is also told to decline when the sources don't cover the question.

The checks are deliberately simple and explainable. They catch invented citations, wrong figures and points with no grounding in the source. They cannot prove that a correctly quoted rule has been applied correctly to someone's situation, which is why every answer links back to the guidance.

Without an API key the app runs in extractive mode: it skips the model and shows the source sentences that best match the question. The rest of the app works the same way.

## Design decisions and trade-offs

| Decision | Why | What it costs |
| --- | --- | --- |
| BM25 keyword search instead of embeddings | The corpus is a few hundred pages of official wording, and users ask using the same terms (GST, registration, filing frequency). Keyword search needs no model or vector database, runs instantly, and its results are easy to explain. | Misses questions phrased very differently from the guidance. The evaluation set measures this; adding embeddings with rank fusion is the next step if recall is the weak point. |
| Sentence-level citations | A page-level link makes the reader hunt for the rule. Sentence ids let the checker compare the point with the exact text, and let the link jump to that sentence. | Sentence splitting has to be careful with "e.g." and amounts like "$1.5 million". This is covered by tests. |
| Numbers must match exactly | In tax, a wrong threshold or date is the most damaging error and the easiest to check mechanically. | A correct point that converts a figure (for example "two months" written as "2 months") can be rejected. Rejected points stay visible, so this is noticeable. |
| Snapshots as JSON files | Simple to inspect, diff and back up for a single-source prototype. | Would move to PostgreSQL for multiple sources, multiple users or history queries. |
| Menu and link lists are not indexed | They carry no guidance, and indexing them reported pages as changed whenever IRD added a link. | A few one-line link descriptions are lost from search. |

## Evaluation

`eval/questions.json` holds 30 questions: 24 GST questions and 6 that are out of scope (income tax, KiwiSaver, Australian GST, writing an email). `npm run eval` reports:

- how many in-scope questions were answered and how many out-of-scope questions were declined
- the share of drafted points that passed the checks
- whether expected facts (such as the $60,000 registration threshold) appear in the answer
- whether the expected page appears in the top five search results, for questions labelled with one

The full report, including every removed point and why, is written to `eval/report.md`. Run `npm run eval -- --label` to see the top pages for each question when labelling expected pages.

## Running it

Requires Node.js 22.9 or later.

```bash
npm install
cp .env.example .env          # optional: add ANTHROPIC_API_KEY (or OpenAI settings)
npm run ingest                # fetch the GST guidance, about 5 minutes at 1 page every 1.5s
npm run build && npm start    # http://localhost:3000
```

For development, `npm run dev` runs the API and the Vite dev server together on http://localhost:5173.

Run `npm run ingest` again later (for example weekly) to pick up changes to the guidance. The first run is the baseline, so the changes tab stays empty until the second run finds something.

Other commands: `npm test`, `npm run typecheck`, `npm run eval`. A Dockerfile and a GitHub Actions workflow (type check, tests, build) are included.

## The crawler

The crawler starts at `https://www.ird.govt.nz/gst` and follows links that stay under that path, up to 200 pages. It reads robots.txt, identifies itself in the User-Agent header, waits 1.5 seconds between requests, skips PDFs and other documents, and extracts the main content with Mozilla Readability so navigation, headers and footers are left out. The scope and rate are set in `config/sources.json`.

## Use of Inland Revenue content

This repository contains no Inland Revenue text. Guidance is fetched when you run the ingest command and stored locally in `data/`, which is ignored by git. The app shows only the sentences it cites, always with a link to the original page. Inland Revenue's statistics are published under a Creative Commons Attribution 4.0 licence; check Inland Revenue's copyright page for the terms that apply to its guidance before publishing a hosted copy of this app.

This is a personal research project. It is not affiliated with or endorsed by Inland Revenue, does not use Inland Revenue's name or logo as branding, and is not tax advice.

## Project layout

```
src/core     crawling, chunking, search, answer checks, change detection
src/cli      ingest and eval commands
src/server   Express API (status, ask, updates) and static hosting
src/web      React interface
test         Vitest tests against a synthetic test site
eval         evaluation questions
```

## Possible next steps

- Add Tax Information Bulletins, operational statements and the GST Act as further sources, with the source type shown on each citation.
- Hybrid search (BM25 plus embeddings) if the evaluation shows recall gaps.
- Scheduled ingest with an email or Slack message when guidance changes.
