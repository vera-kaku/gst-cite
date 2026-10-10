import type { AnswerResult, CheckedPoint, Evidence } from './types.ts';
import type { PassageIndex, Hit } from './search.ts';
import type { LLM } from './llm.ts';
import { parseJsonObject } from './llm.ts';
import { checkPoints, type RawPoint } from './verify.ts';
import { contentWords, deepLink } from './text.ts';

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

/** Without an LLM, return the source sentences that best match the question. */
function extractive(question: string, hits: Hit[]): RawPoint[] {
  const q = new Set(contentWords(question));
  const scored = hits.flatMap((h, rank) =>
    h.passage.sentences.map((s) => {
      const w = contentWords(s.text);
      const overlap = w.filter((x) => q.has(x)).length;
      return { s, score: overlap / Math.sqrt(w.length + 1) + (hits.length - rank) * 0.05, overlap };
    }),
  );
  return scored
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => ({ text: x.s.text, citations: [x.s.id] }));
}

export async function answerQuestion(question: string, index: PassageIndex, llm: LLM | null, k = 8): Promise<AnswerResult> {
  const hits = index.search(question, k);
  const base = {
    question,
    retrieved: hits.map((h) => ({ passageId: h.passage.id, url: h.passage.url, pageTitle: h.passage.pageTitle, heading: h.passage.heading, score: Math.round(h.score * 100) / 100 })),
    snapshotId: index.snapshot.id,
  };
  if (!hits.length) {
    return { ...base, mode: llm ? 'llm' : 'extractive', answerable: false, points: [], rejected: [], evidence: {}, note: 'Nothing in the indexed guidance matches this question.' };
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
    raw = extractive(question, hits);
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
