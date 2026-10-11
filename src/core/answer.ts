import type { AnswerResult, CheckedPoint, Evidence } from './types.ts';
import type { PassageIndex, Hit } from './search.ts';
import type { LLM } from './llm.ts';
import { parseJsonObject } from './llm.ts';
import { checkPoints, type RawPoint } from './verify.ts';
import { contentWords, deepLink, hasTerm } from './text.ts';

export const ANSWER_SYSTEM = `You answer questions about New Zealand GST for tax professionals, using ONLY the numbered source sentences supplied from Inland Revenue guidance.

Rules:
- Every point must be directly supported by the sentences it cites. Do not add facts from memory.
- Keep amounts, rates, dates and thresholds exactly as they appear in the sources.
- Each point is one or two short sentences in plain English. Give at most 6 points, most important first.
- Cite 1 to 3 sentence ids per point, using the ids shown in angle brackets, e.g. "a1b2c3d4-3.1".
- If the sources do not answer the question, set "answerable" to false and return no points. Do not guess.
- If the answer depends on facts the question does not give, say so in "note".

Reply with JSON only, in this shape:
{"answerable": true, "points": [{"text": "...", "citations": ["id"]}], "note": ""}`;

export function buildContext(hits: Hit[]): { prompt: string; allowed: Map<string, string> } {
  const allowed = new Map<string, string>();
  const parts = hits.map((h, i) => {
    const p = h.passage;
    const lines = p.sentences.map((s) => {
      allowed.set(s.id, s.text);
      return `<${s.id}> ${s.text}`;
    });
    return `[Source ${i + 1}] ${p.pageTitle} > ${p.heading}\n${p.url}\n${lines.join('\n')}`;
  });
  return { prompt: parts.join('\n\n'), allowed };
}

function evidenceFor(points: CheckedPoint[], index: PassageIndex): Record<string, Evidence> {
  const out: Record<string, Evidence> = {};
  for (const id of points.flatMap((p) => p.citations)) {
    const hit = index.sentences.get(id);
    if (!hit) continue;
    out[id] = {
      sentenceId: id,
      text: hit.sentence.text,
      url: hit.passage.url,
      pageTitle: hit.passage.pageTitle,
      heading: hit.passage.heading,
      deepLink: deepLink(hit.passage.url, hit.sentence.text),
    };
  }
  return out;
}

/** Questions that usually need a figure: an amount, rate, date, period or threshold. */
const WANTS_FIGURE = /\b(when|how (much|many|long|often|quickly|soon)|rate|threshold|limit|due|deadline|percent|amount|turnover|over|under|within)\b|\d/i;

/** A short line without a full stop, such as a table or list header ("6-monthly"). */
const isLabel = (text: string) => text.split(' ').length < 4 && !/[.?!]$/.test(text);

/**
 * Without an LLM, quote the source sentences that best answer the question. Sentences
 * come mainly from the best-ranked passages; for questions about amounts, dates or
 * periods, sentences containing figures are preferred. A short label just before a
 * sentence (a table header such as "6-monthly") is scored with it and quoted with it.
 */
export function extractive(question: string, hits: Hit[], index: PassageIndex, max = 4): RawPoint[] {
  const terms = index.queryTerms(question);
  const wantsFigure = WANTS_FIGURE.test(question);
  const passageWeight = [1, 0.6, 0.4];
  const scored = hits.slice(0, passageWeight.length).flatMap((h, rank) =>
    h.passage.sentences.map((s, order) => {
      const prev = h.passage.sentences[order - 1];
      const label = prev && isLabel(prev.text) ? prev : undefined;
      const words = new Set(contentWords(label ? `${label.text} ${s.text}` : s.text));
      let total = 0;
      let found = 0;
      for (const t of terms) {
        const w = index.idf(t);
        total += w;
        if (hasTerm(words, t)) found += w;
      }
      const sentCoverage = total ? found / total : 0;
      const figure = wantsFigure && /\d/.test(s.text) ? 0.35 : 0;
      const score = isLabel(s.text) ? 0 : passageWeight[rank]! * (0.6 * sentCoverage + 0.4 * h.coverage + figure);
      return { s, label, score, sentCoverage, figure, rank, order };
    }),
  );
  return scored
    .filter((x) => x.score > 0 && (x.sentCoverage > 0 || x.figure > 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((x) => (x.label ? { text: `${x.label.text}: ${x.s.text}`, citations: [x.label.id, x.s.id] } : { text: x.s.text, citations: [x.s.id] }));
}

/** Below this share of the question's terms in the best passage, the guidance is treated as not covering it. */
export const MIN_COVERAGE = 0.3;
/** If the question uses words that never appear in the guidance, a higher share is required. */
export const MIN_COVERAGE_WITH_UNKNOWN = 0.5;

/** Decides before any model call whether the indexed guidance is likely to cover the question. */
export function coverageCheck(question: string, hits: Hit[], index: PassageIndex): { covered: boolean; unknown: string[]; best: number } {
  const best = hits[0]?.coverage ?? 0;
  const unknown = index.unknownTerms(question);
  const covered = best >= MIN_COVERAGE && !(unknown.length && best < MIN_COVERAGE_WITH_UNKNOWN);
  return { covered, unknown, best };
}

export async function answerQuestion(question: string, index: PassageIndex, llm: LLM | null, k = 8): Promise<AnswerResult> {
  const hits = index.search(question, k);
  const base = {
    question,
    retrieved: hits.map((h) => ({ passageId: h.passage.id, url: h.passage.url, pageTitle: h.passage.pageTitle, heading: h.passage.heading, score: Math.round(h.score * 100) / 100 })),
    snapshotId: index.snapshot.id,
  };
  const check = coverageCheck(question, hits, index);
  if (!hits.length || !check.covered) {
    const words = check.unknown.length ? ` It uses terms that do not appear in the guidance at all.` : '';
    return {
      ...base,
      mode: llm ? 'llm' : 'extractive',
      answerable: false,
      points: [],
      rejected: [],
      evidence: {},
      note: `The indexed GST guidance does not appear to cover this question.${words} Only Inland Revenue's GST pages are searched.`,
    };
  }
  const { prompt, allowed } = buildContext(hits);

  let raw: RawPoint[];
  let answerable = true;
  let note: string | undefined;
  let mode: AnswerResult['mode'] = 'llm';
  if (llm) {
    const reply = await llm.complete(ANSWER_SYSTEM, `Question: ${question}\n\nSources:\n${prompt}`);
    const parsed = parseJsonObject<{ answerable?: boolean; points?: RawPoint[]; note?: string }>(reply);
    answerable = parsed.answerable !== false;
    raw = answerable ? (parsed.points ?? []) : [];
    note = parsed.note || undefined;
  } else {
    mode = 'extractive';
    raw = extractive(question, hits, index);
    note = 'No language model is configured, so these are the source sentences that best match your question.';
  }

  const { verified, rejected } = checkPoints(raw, allowed);
  if (answerable && !verified.length) {
    answerable = false;
    note = rejected.length
      ? 'An answer was drafted, but none of its points could be matched to the cited guidance, so it is not shown.'
      : note ?? 'The indexed guidance does not answer this question.';
  }
  return { ...base, mode, answerable, points: verified, rejected, evidence: evidenceFor([...verified, ...rejected], index), note };
}
