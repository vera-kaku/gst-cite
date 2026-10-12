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
keyword search (BM25) over passages, top 40 re-ranked by how much of the
question each passage covers ──► top 8 passages, every sentence given an id
   │
   ▼
coverage check: if the best passage covers too little of the question,
say the guidance does not cover it (no model call)
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
| BM25 keyword search instead of embeddings | The corpus is about 70 pages of official wording, and many questions use the same terms (GST, registration, filing frequency). Keyword search needs no model or vector database, runs instantly, and its results are easy to explain. | Misses questions phrased differently from the guidance ("What will my GST number be?" ranks 6th). Held-out questions show this clearly (see Evaluation); embeddings with rank fusion are the next step. |
| Re-rank by question coverage | BM25 favours short passages that repeat one query word, such as "rate" on the exchange-rate page. Re-ranking by the share of the question's terms a passage covers, weighted by how rare each term is, and preferring headings about only what was asked, fixes most of these. | Tuned on a small question set. On held-out questions it helped only slightly, so the gain should not be overstated. |
| Decline when coverage is low | If the best passage covers under 30% of the question, or the question uses words that never appear in the guidance and coverage is under 50%, the app says the guidance does not cover it, without calling the model. | Some unrelated questions still pass (for example "income tax rates", which shares "tax" and "rate"); in LLM mode the model is the second line of defence. |
| Porter stemming with prefix matching | The first version used a home-made stemmer that treated "register" and "registration" as different words. Porter stemming, plus treating a 5-letter stem that starts a longer one as the same word, fixed this and was the single biggest retrieval gain. | Can occasionally join unrelated words that share a long prefix. |
| Sentence-level citations | A page-level link makes the reader hunt for the rule. Sentence ids let the checker compare the point with the exact text, and let the link jump to that sentence. | Sentence splitting has to be careful with "e.g." and amounts like "$1.5 million". This is covered by tests. |
| Numbers must match exactly | In tax, a wrong threshold or date is the most damaging error and the easiest to check mechanically. | A correct point that converts a figure (for example "two months" written as "2 months") can be rejected. Rejected points stay visible, so this is noticeable. |
| Snapshots as JSON files | Simple to inspect, diff and back up for a single-source prototype. | Would move to PostgreSQL for multiple sources, multiple users or history queries. |
| Page structure made explicit before extraction | Inland Revenue puts much of its guidance in accordions. Their titles are buttons, and sub-topics are bold paragraphs, so at first they were read as ordinary sentences and every later section kept the last real heading on the page (on the zero-rated page, "Tax Technical website"). Accordion titles now become section headings, short bold paragraphs become sub-headings, and citations show the path, e.g. "Exported goods › Timeframe for exporting". | Relies on common markup patterns (`button[aria-expanded]`, bold-only paragraphs of 8 words or fewer); a site that marks up sections differently needs its own rule. |
| Use the site's content container when it has one | Readability guesses which block of a page is the content. On short hub pages it picked the wrong block, and on the zero-rated page it silently dropped a whole section ("Land transactions"). Inland Revenue pages mark their content with `#main-content`, so `config/sources.json` names it and Readability is only the fallback. Text placed directly in a `div` rather than a paragraph is also kept now. | The selector is site-specific; if the site changes its markup, extraction falls back to Readability and the crawl log warns about pages with very little text. |
| Site widgets removed by selector | A "GST Dates" widget appears on some pages and changes every month. Left in, it would make those pages look edited on every run. `config/sources.json` lists CSS selectors to drop before extraction. | Needs updating if the site adds new widgets; the tests include a widget whose dates change between runs to catch this. |
| Menu and link lists are not indexed | They carry no guidance, and indexing them reported pages as changed whenever IRD added a link. | A few one-line link descriptions are lost from search. |

## Evaluation

`eval/questions.json` holds 44 questions:

- 23 GST questions used while tuning search, each labelled with the pages that answer it
- 10 held-out GST questions written after tuning, to check the tuning was not just fitted to the first set
- 3 real GST questions whose answers are outside the `/gst` section of the IRD site (record keeping, amending a filed return, claims before registration), which an honest system should decline. A fourth (land sales between registered businesses) was first put in this group, then found to be answered by a section the first extractor had dropped
- 8 unrelated questions (income tax, KiwiSaver, PAYE, Australian GST, writing an email)

`npm run eval` writes a report to `eval/report.md` with every question, the rank of its expected page, and every point that failed the checks and why.

### Results so far (extractive mode, 44 questions)

The first two columns were measured on one snapshot taken before the content-container change above. The third column is a fresh crawl with the content container (snapshot `2026-10-11T11-18-02-775Z`, 71 pages, 458 passages), so its search settings match the "Search tuned" column but its extraction does not.

The denominators change in the third column because the land question moved from "should be declined" to "should be answered" once the fresh extraction kept the section that answers it. That gives 23 tuning questions instead of 22, 33 answerable questions instead of 32, and 11 questions to decline instead of 12. The land question is ranked third, so it adds to "top 5" but not to "ranked first".

| Measure | First version | Search tuned | Content container, fresh snapshot |
| --- | --- | --- | --- |
| Expected page in top 5 (tuning questions) | 19 of 22 | 21 of 22 | 21 of 23 |
| Expected page ranked first (tuning questions) | 11 of 22 | 16 of 22 | 17 of 23 |
| Expected page in top 5 (held-out questions) | 8 of 10 | 8 of 10 | 7 of 10 |
| Expected page ranked first (held-out questions) | 4 of 10 | 4 of 10 | 5 of 10 |
| Expected page anywhere in the 8 passages sent to the model (all) | 27 of 32 | 31 of 32 | 31 of 33 |
| Expected facts present in the answer | 6 of 15 | 9 of 15 | 9 of 15 |
| Questions that should be declined and were | 0 of 12 | 6 of 12 | 5 of 11 |
| Answerable questions wrongly declined | 0 | 0 | 0 |

"Top 5" and "ranked first" count passages: the expected page must supply one of the first five passages, or the first one.

The held-out rows are the honest measure of the search changes. Search tuning did not improve them; after the content-container change, one more held-out question has its page ranked first and one fewer has it in the top 5, so they are roughly level there too. The gains that did carry over are the stemming fix and the coverage check, which declines about half of the unanswerable questions without turning away any answerable ones (both held-out unanswerable questions are declined). In LLM mode all 8 passages go to the model, so the row that matters most there is "expected page anywhere in the 8 passages".

Known misses on the fresh snapshot: "What is the GST rate in New Zealand?" finds none of its four expected pages in the 8 passages, even though the GST home page states the 15% rate (the top passage is about converting currency to New Zealand dollars). The held-out question on low value imported goods also misses all 8 passages.

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

The crawler starts at `https://www.ird.govt.nz/gst` and follows links that stay under that path, up to 200 pages. It reads robots.txt, identifies itself in the User-Agent header, waits 1.5 seconds between requests, skips PDFs and other documents, and extracts the main content with Mozilla Readability so navigation, headers and footers are left out. Before extraction it drops the elements listed in `removeSelectors` and turns accordion titles and bold sub-headings into real headings. The scope, rate and selectors are set in `config/sources.json`.

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
