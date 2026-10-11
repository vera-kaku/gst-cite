import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Page, Passage, Sentence } from './types.ts';
import { normaliseSpace, sha256, splitSentences } from './text.ts';

const BLOCKS = 'h1,h2,h3,h4,h5,p,li,tr,dt,dd,blockquote,figcaption';
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5']);
const MAX_PASSAGE_WORDS = 160;

interface Block {
  heading: boolean;
  text: string;
}

/** Pulls the main content out of a page, dropping navigation, headers and footers. */
export function extractMain(html: string, url: string): { title: string; contentHtml: string } {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  // Inland Revenue headings are bilingual: the te reo Māori title sits in a
  // <span lang="mi"> before the English one. The corpus is the English guidance,
  // so the Māori part is dropped from headings to keep titles and citations clean.
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => h.querySelectorAll('[lang|="mi"]').forEach((n) => n.remove()));
  const rawTitle = doc.querySelector('h1')?.textContent || doc.title || url;
  const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 200 }).parse();
  let contentHtml = article?.content ?? '';
  if (normaliseSpace(article?.textContent ?? '').length < 200) {
    const main = doc.querySelector('main, [role=main], article') ?? doc.body;
    // aria-hidden is not removed: collapsed accordion panels often use it and hold real guidance.
    main?.querySelectorAll('script, style, nav, header, footer, form, noscript').forEach((n) => n.remove());
    contentHtml = main?.innerHTML ?? '';
  }
  const title = normaliseSpace(rawTitle).replace(/\s+[|\-–]\s+[^|\-–]+$/, '');
  return { title, contentHtml };
}

/** Turns content HTML into ordered text blocks without duplicating nested text. */
export function toBlocks(contentHtml: string): Block[] {
  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const doc = dom.window.document;
  const els = Array.from(doc.body.querySelectorAll(BLOCKS));
  const blocks: Block[] = [];
  for (const el of els) {
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(BLOCKS).forEach((n) => n.remove());
    let text: string;
    if (el.tagName === 'TR') {
      text = Array.from(el.querySelectorAll('th,td'))
        .map((c) => normaliseSpace(c.textContent ?? ''))
        .filter(Boolean)
        .join(' | ');
      if (el.querySelector(BLOCKS)) continue;
    } else {
      text = normaliseSpace(clone.textContent ?? '');
    }
    if (!text) continue;
    if (!HEADINGS.has(el.tagName) && isLinkOnly(clone, text)) continue;
    blocks.push({ heading: HEADINGS.has(el.tagName), text });
  }
  return blocks;
}

/**
 * Menu items and "related pages" lists are pure link text. They carry no guidance,
 * and indexing them would report a page as changed whenever a link is added.
 */
function isLinkOnly(el: Element, text: string): boolean {
  const linkText = normaliseSpace(Array.from(el.querySelectorAll('a')).map((a) => a.textContent ?? '').join(' '));
  return linkText.length > 0 && linkText.length >= text.length * 0.9 && text.split(' ').length <= 15;
}

export function chunkPage(url: string, title: string, blocks: Block[]): Passage[] {
  const prefix = sha256(url).slice(0, 8);
  const passages: Passage[] = [];
  let heading = title;
  let current: string[] = [];
  let words = 0;

  const flush = () => {
    if (!current.length) return;
    const id = `${prefix}-${passages.length}`;
    const sentences: Sentence[] = current.map((text, i) => ({ id: `${id}.${i}`, text }));
    passages.push({ id, url, pageTitle: title, heading, sentences });
    current = [];
    words = 0;
  };

  for (const b of blocks) {
    if (b.heading) {
      flush();
      if (normaliseSpace(b.text) !== normaliseSpace(title)) heading = b.text;
      continue;
    }
    const sentences = splitSentences(b.text);
    const n = b.text.split(' ').length;
    if (words + n > MAX_PASSAGE_WORDS && words > 0) flush();
    current.push(...sentences);
    words += n;
  }
  flush();
  return passages;
}

export function buildPage(url: string, html: string, fetchedAt = new Date().toISOString()): Page {
  const { title, contentHtml } = extractMain(html, url);
  const passages = chunkPage(url, title, toBlocks(contentHtml));
  const fullText = passages.flatMap((p) => p.sentences.map((s) => s.text)).join('\n');
  return { url, title, fetchedAt, hash: sha256(fullText), passages };
}
