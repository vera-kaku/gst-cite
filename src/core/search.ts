import MiniSearch from 'minisearch';
import type { Passage, Sentence, Snapshot } from './types.ts';
import { STOPWORDS } from './text.ts';

interface Doc {
  id: string;
  pageTitle: string;
  heading: string;
  text: string;
}

export interface Hit {
  passage: Passage;
  score: number;
}

/**
 * BM25 keyword search over passages. For a closed corpus of a few hundred pages,
 * keyword search on official wording works well and keeps the system explainable;
 * see the README for the trade-off against embeddings.
 */
export class PassageIndex {
  private ms: MiniSearch<Doc>;
  readonly passages = new Map<string, Passage>();
  readonly sentences = new Map<string, { sentence: Sentence; passage: Passage }>();

  constructor(readonly snapshot: Snapshot) {
    this.ms = new MiniSearch<Doc>({
      fields: ['pageTitle', 'heading', 'text'],
      storeFields: [],
      processTerm: (term) => {
        const t = term.toLowerCase();
        return t.length < 2 || STOPWORDS.has(t) ? null : t;
      },
      searchOptions: { boost: { pageTitle: 1.5, heading: 2 }, prefix: (t) => t.length > 4, fuzzy: (t) => (t.length > 6 ? 0.15 : false), combineWith: 'OR' },
    });
    const docs: Doc[] = [];
    for (const page of snapshot.pages) {
      for (const p of page.passages) {
        this.passages.set(p.id, p);
        for (const s of p.sentences) this.sentences.set(s.id, { sentence: s, passage: p });
        docs.push({ id: p.id, pageTitle: p.pageTitle, heading: p.heading, text: p.sentences.map((s) => s.text).join(' ') });
      }
    }
    this.ms.addAll(docs);
  }

  search(query: string, k = 8): Hit[] {
    return this.ms
      .search(query)
      .slice(0, k)
      .map((r) => ({ passage: this.passages.get(String(r.id))!, score: r.score }));
  }
}
