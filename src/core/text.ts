import { createHash } from 'node:crypto';
import { stemmer } from 'stemmer';

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
    'how why should could get got need needs use used using under over out own same very s t don shall take count mean ' +
    'myself yourself ourselves themselves itself quickly really actually exactly please every')
    .split(' '),
);

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };

/**
 * Lowercase word tokens before stemming. Hyphenated words stay whole ("zero-rated"), so a
 * question about the GST "rate" does not match every page about zero-rated supplies.
 * Periods are normalised: a number word becomes digits and is joined to a following day,
 * week, month or year, so "six months", "6-monthly" and "6 monthly" all produce a token
 * starting "6month". Other numbers are left alone ("one group" stays "one group").
 */
export function tokenize(text: string): string[] {
  const t = text
    .toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?=[ -](day|week|month|year))/g, (w) => NUMBER_WORDS[w]!)
    .replace(/\b(\d{1,3})[ -](?=(day|week|month|year))/g, '$1');
  return (t.match(/[a-z0-9][a-z0-9'-]*[a-z]/g) ?? []).map((w) => w.replace(/'s$/, '').replace(/['-]/g, ''));
}

/** Content words: tokens without stopwords, Porter-stemmed. */
export function contentWords(text: string): string[] {
  return tokenize(text)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

export const stem = (w: string) => stemmer(w);

/**
 * True if two stems are the same word. Porter stemming leaves some related forms apart
 * ("regist" for register, "registr" for registration), so a stem of 5 or more letters
 * that starts the other stem also counts as a match.
 */
export function sameTerm(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.startsWith(short);
}

/** Whether a set of stems contains a term, allowing the prefix match above. */
export function hasTerm(set: Set<string>, term: string): boolean {
  if (set.has(term)) return true;
  if (term.length < 5) return false;
  for (const u of set) if (sameTerm(u, term)) return true;
  return false;
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
