import type { CheckedPoint } from './types.ts';
import { contentWords, extractNumbers } from './text.ts';

export interface RawPoint {
  text: string;
  citations: string[];
}

export const MIN_SUPPORT = 0.5;

/**
 * Checks one generated point against the sentences it cites. A point is kept only if
 *  1. it cites at least one sentence that was actually shown to the model,
 *  2. every number in it appears in the cited sentences (amounts, rates, dates), and
 *  3. at least half of its content words appear in the cited sentences.
 * These checks are deliberately simple and explainable. They catch invented citations,
 * wrong figures and points with no grounding; they cannot prove the reasoning is right.
 */
export function checkPoint(point: RawPoint, allowed: Map<string, string>): CheckedPoint {
  const reasons: string[] = [];
  const citations = [...new Set((point.citations ?? []).map(String))];
  const valid = citations.filter((c) => allowed.has(c));
  const invalid = citations.filter((c) => !allowed.has(c));
  if (!citations.length) reasons.push('no citation');
  if (invalid.length) reasons.push(`cites sentences that were not in the sources: ${invalid.join(', ')}`);

  const cited = valid.map((c) => allowed.get(c)!).join(' ');
  const citedNumbers = new Set(extractNumbers(cited));
  const missing = extractNumbers(point.text).filter((n) => !citedNumbers.has(n));
  if (valid.length && missing.length) reasons.push(`figures not found in the cited text: ${missing.join(', ')}`);

  const words = [...new Set(contentWords(point.text))];
  const citedWords = new Set(contentWords(cited));
  const support = words.length ? words.filter((w) => citedWords.has(w)).length / words.length : 0;
  if (valid.length && support < MIN_SUPPORT) reasons.push(`only ${Math.round(support * 100)}% of the wording is supported by the cited text`);

  return {
    text: point.text,
    citations: valid.length ? valid : citations,
    status: reasons.length ? 'rejected' : 'verified',
    reasons,
    support: Math.round(support * 100) / 100,
  };
}

export function checkPoints(points: RawPoint[], allowed: Map<string, string>) {
  const checked = points.filter((p) => p && typeof p.text === 'string' && p.text.trim()).map((p) => checkPoint(p, allowed));
  return {
    verified: checked.filter((p) => p.status === 'verified'),
    rejected: checked.filter((p) => p.status === 'rejected'),
  };
}
