import { createHash } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const normaliseSpace = (s: string) => s.replace(/\s+/g, ' ').trim();

const ABBREVIATIONS = ['e.g', 'i.e', 'etc', 'eg', 'ie', 'no', 'nos', 's', 'ss', 'pt', 'para', 'ltd', 'inc', 'vs', 'approx', 'mr', 'mrs', 'ms', 'dr', 'st', 'sch', 'cl'];

/**
 * Splits text into sentences. Conservative on purpose: a wrong split only makes a
 * citation shorter, but splitting inside "e.g." or "$1.5 million" would break evidence.
 */
export function splitSentences(text: string): string[] {
  const t = normaliseSpace(text);
  if (!t) return [];
  const out: string[] = [];
  let start = 0;
  const re = /[.?!](?=["')\]]?\s+["'(\[]?[A-Z0-9$])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const end = m.index + 1;
    const before = t.slice(start, end);
    const lastWord = (before.match(/([A-Za-z.]+)\.$/)?.[1] ?? '').toLowerCase().replace(/\.$/, '');
    if (ABBREVIATIONS.includes(lastWord)) continue;
    // Skip single capital letters used as initials ("J. Smith").
    if (/\b[A-Z]\.$/.test(before)) continue;
    out.push(t.slice(start, end).trim());
    start = end;
  }
  const rest = t.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter((s) => s.length > 1);
}

export const STOPWORDS = new Set(
  ('a an and are as at be been but by can do does for from has have if in into is it its may must not of on or ' +
    'our so such than that the their them then there these they this to too up was we were what when where which ' +
    'who will with would you your i me my he she his her us also any each other about more most some only just ' +
    'how why should could get got need needs use used using under over out own same very s t don shall')
    .split(' '),
);

/** Lowercase word tokens with a crude stem, used for overlap scoring. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

export function stem(w: string): string {
  return w
    .replace(/(ies)$/, 'y')
    .replace(/(ing|ed|es|s|ly)$/, '')
    .slice(0, 7);
}

/**
 * Numbers that matter in tax answers: amounts, rates, days, years, section numbers.
 * Returned in a normalised form ("$60,000" -> "60000", "15%" -> "15").
 */
export function extractNumbers(text: string): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(found.map(normNumber))];
}

export const normNumber = (n: string) => n.replace(/,/g, '').replace(/\.0+$/, '');

/** Text fragment link so the browser scrolls to and highlights the cited sentence. */
export function deepLink(url: string, sentence: string): string {
  const words = normaliseSpace(sentence).split(' ');
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C');
  if (words.length <= 10) return `${url}#:~:text=${enc(words.join(' '))}`;
  return `${url}#:~:text=${enc(words.slice(0, 5).join(' '))},${enc(words.slice(-4).join(' '))}`;
}
