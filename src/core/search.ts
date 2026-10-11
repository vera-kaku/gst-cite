import MiniSearch from 'minisearch';
import type { Passage, Sentence, Snapshot } from './types.ts';
import { STOPWORDS, contentWords, hasTerm, stem, tokenize } from './text.ts';

interface Doc {
  id: string;
  pageTitle: string;
  heading: string;
  text: string;
}

export interface Hit {
  passage: Passage;
  /** Final ranking score. */
  score: number;
  /** Raw BM25 score from the keyword index. */
  bm25: number;
  /** Share of the question's terms (weighted by rarity) found in this passage, 0 to 1. */
  coverage: number;
}

export interface SearchOptions {
  titleBoost: number;
  headingBoost: number;
  /** How strongly coverage scales the BM25 score: score = bm25 * coverage^coverageWeight. */
  coverageWeight: number;
  /**
   * How strongly to prefer passages whose title or heading is about only what was asked.
   * A heading such as "Register for GST as a group" adds a topic ("group") the question
   * did not mention, so it ranks below "Who needs to register for GST".
   */
  headingFocus: number;
  /** How many BM25 results are re-ranked. */
  candidates: number;
}

/**
 * Chosen with a grid search over the labelled evaluation questions (see README). These
 * values sit in the middle of a range of settings that scored similarly, rather than at
 * the single best point, to reduce over-fitting to a small question set.
 */
export const DEFAULT_SEARCH: SearchOptions = { titleBoost: 1.5, headingBoost: 1, coverageWeight: 2, headingFocus: 1, candidates: 40 };

/** Terms that carry no topic information in a GST-only corpus. */
const CORPUS_GENERIC = new Set(['gst', 'tax', 'new', 'zealand', 'inland', 'revenue', 'ird'].map((w) => contentWords(w)[0] ?? w));

/**
 * Two-stage keyword search. BM25 (MiniSearch) finds candidates, then each candidate
 * is re-ranked by how much of the question it covers, weighting rare terms more than
 * common ones, and by whether the passage's heading is about what was asked. BM25 alone favours short passages
 * that repeat one query word (for example "rate" on the exchange-rate page); the
 * coverage step prefers passages that match the question as a whole.
 */
export class PassageIndex {
  private ms: MiniSearch<Doc>;
  readonly passages = new Map<string, Passage>();
  readonly sentences = new Map<string, { sentence: Sentence; passage: Passage }>();
  /** Stemmed content words per passage (title, heading and text). */
  private terms = new Map<string, Set<string>>();
  /** Number of passages each stemmed term appears in. */
  private df = new Map<string, number>();
  private dfCache = new Map<string, number>();

  constructor(
    readonly snapshot: Snapshot,
    readonly opts: SearchOptions = DEFAULT_SEARCH,
  ) {
    this.ms = new MiniSearch<Doc>({
      fields: ['pageTitle', 'heading', 'text'],
      storeFields: [],
      // Same tokens and stems as contentWords(), so both ranking stages agree on what a word is.
      tokenize,
      processTerm: (t) => (t.length < 2 || STOPWORDS.has(t) ? null : stem(t)),
      searchOptions: {
        boost: { pageTitle: opts.titleBoost, heading: opts.headingBoost },
        prefix: (t) => t.length > 4,
        fuzzy: (t) => (t.length > 6 ? 0.15 : false),
        combineWith: 'OR',
      },
    });
    const docs: Doc[] = [];
    for (const page of snapshot.pages) {
      for (const p of page.passages) {
        this.passages.set(p.id, p);
        for (const s of p.sentences) this.sentences.set(s.id, { sentence: s, passage: p });
        const text = p.sentences.map((s) => s.text).join(' ');
        docs.push({ id: p.id, pageTitle: p.pageTitle, heading: p.heading, text });
        const words = contentWords(`${p.pageTitle} . ${p.heading} . ${text}`);
        const set = new Set(words);
        this.terms.set(p.id, set);
        for (const w of set) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      }
    }
    this.ms.addAll(docs);
  }

  /** Rarity weight of a term. Terms missing from the corpus get the highest weight. */
  idf(term: string): number {
    const n = this.passages.size;
    return Math.log((n + 1) / (this.docFreq(term) + 0.5));
  }

  /** Passages containing the term, counting related stems ("regist" and "registr") together. */
  docFreq(term: string): number {
    const cached = this.dfCache.get(term);
    if (cached !== undefined) return cached;
    let n = this.df.get(term) ?? 0;
    if (term.length >= 5) {
      n = 0;
      for (const set of this.terms.values()) if (hasTerm(set, term)) n++;
    }
    this.dfCache.set(term, n);
    return n;
  }

  /** The question's distinct content terms, without words that every GST passage shares. */
  queryTerms(query: string): string[] {
    const words = [...new Set(contentWords(query))];
    const specific = words.filter((w) => !CORPUS_GENERIC.has(w));
    return specific.length ? specific : words;
  }

  /** Question terms that appear nowhere in the indexed guidance. */
  unknownTerms(query: string): string[] {
    return this.queryTerms(query).filter((t) => this.docFreq(t) === 0);
  }

  /** Share of a title's or heading's words (weighted by rarity) that the question also uses; the better of the two. */
  headingPrecision(p: Passage, terms: Set<string>): number {
    const prec = (label: string) => {
      const words = [...new Set(contentWords(label))].filter((w) => !CORPUS_GENERIC.has(w));
      if (!words.length) return 0;
      let total = 0;
      let found = 0;
      for (const w of words) {
        const weight = this.idf(w);
        total += weight;
        if (hasTerm(terms, w)) found += weight;
      }
      return total ? found / total : 0;
    };
    return Math.max(prec(p.heading), prec(p.pageTitle));
  }

  coverage(passageId: string, terms: string[]): number {
    const have = this.terms.get(passageId);
    if (!have || !terms.length) return 0;
    let total = 0;
    let found = 0;
    for (const t of terms) {
      const w = this.idf(t);
      total += w;
      if (hasTerm(have, t)) found += w;
    }
    return total ? found / total : 0;
  }

  search(query: string, k = 8): Hit[] {
    const terms = this.queryTerms(query);
    const termSet = new Set(terms);
    const results = this.ms.search(query).slice(0, this.opts.candidates);
    const hits = results.map((r) => {
      const id = String(r.id);
      const coverage = this.coverage(id, terms);
      const passage = this.passages.get(id)!;
      const focus = 0.5 + 0.5 * this.headingPrecision(passage, termSet);
      const score = r.score * Math.pow(coverage, this.opts.coverageWeight) * Math.pow(focus, this.opts.headingFocus);
      return { passage, bm25: r.score, coverage, score };
    });
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
