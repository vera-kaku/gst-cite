import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { Page, Passage, Sentence } from './types.ts';
import { normaliseSpace, sha256, splitSentences } from './text.ts';

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,tr,dt,dd,blockquote,figcaption';
const HEADING_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const MAX_PASSAGE_WORDS = 160;

interface Block {
  /** Heading level 1 to 6, or 0 for body text. */
  level: number;
  text: string;
}

export interface ExtractOptions {
  /** CSS selectors for page furniture to drop before extraction, e.g. a "key dates" widget. */
  removeSelectors?: string[];
  /**
   * CSS selector for the element that holds the page's own content. When it is present,
   * that element is used as is; otherwise Readability guesses which block is the content.
   */
  contentSelector?: string;
}

const retag = (el: Element, tag: string) => {
  const doc = el.ownerDocument;
  const h = doc.createElement(tag);
  h.textContent = el.textContent;
  el.replaceWith(h);
  return h;
};

/**
 * Makes the page's structure explicit before extraction:
 *  - accordion toggle buttons ("Exported goods") become h2 headings, and headings inside
 *    the accordion panel move one level down so they sit under it;
 *  - a paragraph that is only a short bold phrase ("Timeframe for exporting") becomes a
 *    minor heading.
 * Without this, accordion titles were read as ordinary sentences and every following
 * section kept the last real heading on the page.
 */
export function normaliseStructure(doc: Document, opts: ExtractOptions = {}) {
  for (const sel of opts.removeSelectors ?? []) doc.querySelectorAll(sel).forEach((n) => n.remove());

  // Inland Revenue headings are bilingual: the te reo Māori title sits in a
  // <span lang="mi"> before the English one. The corpus is the English guidance,
  // so the Māori part is dropped from headings to keep titles and citations clean.
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => h.querySelectorAll('[lang|="mi"]').forEach((n) => n.remove()));

  doc.querySelectorAll('button[aria-expanded]').forEach((btn) => {
    const text = normaliseSpace(btn.textContent ?? '');
    const panel = btn.parentElement;
    if (!text || !panel) return btn.remove();
    panel.querySelectorAll('h2,h3,h4,h5').forEach((h) => retag(h, `h${Number(h.tagName[1]) + 1}`));
    retag(btn, 'h2');
  });

  doc.querySelectorAll('p').forEach((p) => {
    const text = normaliseSpace(p.textContent ?? '');
    const strong = p.querySelector(':scope > strong, :scope > b');
    if (!strong || normaliseSpace(strong.textContent ?? '') !== text) return;
    if (text.split(' ').length > 8 || /[.:;?!]$/.test(text)) return;
    retag(p, 'h5');
  });
}

/** Pulls the main content out of a page, dropping navigation, headers and footers. */
export function extractMain(html: string, url: string, opts: ExtractOptions = {}): { title: string; contentHtml: string } {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  normaliseStructure(doc, opts);
  const rawTitle = doc.querySelector('h1')?.textContent || doc.title || url;
  const title = normaliseSpace(rawTitle).replace(/\s+[|\-–]\s+[^|\-–]+$/, '');

  const marked = opts.contentSelector ? doc.querySelector(opts.contentSelector) : null;
  if (marked) {
    // "Pages in this section" menus and similar navigation are not guidance.
    marked.querySelectorAll('script, style, nav, form, noscript').forEach((n) => n.remove());
    return { title, contentHtml: marked.innerHTML };
  }

  const article = new Readability(doc.cloneNode(true) as Document, { charThreshold: 200 }).parse();
  let contentHtml = article?.content ?? '';
  if (normaliseSpace(article?.textContent ?? '').length < 200) {
    const main = doc.querySelector('main, [role=main], article') ?? doc.body;
    // aria-hidden is not removed: collapsed accordion panels often use it and hold real guidance.
    main?.querySelectorAll('script, style, nav, header, footer, form, noscript').forEach((n) => n.remove());
    contentHtml = main?.innerHTML ?? '';
  }
  return { title, contentHtml };
}

const INLINE = new Set(['A', 'ABBR', 'B', 'BR', 'CITE', 'CODE', 'EM', 'I', 'MARK', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U']);

/**
 * Wraps text that sits directly in a container (for example
 * `<div class="field-content">Zero-rated supplies are...</div>`) in a paragraph, so it is
 * not skipped. Only block elements are read later, and some pages put their opening
 * sentence straight into a div.
 */
export function wrapLooseText(root: Element) {
  const doc = root.ownerDocument;
  const containers = [root, ...Array.from(root.querySelectorAll('*'))].filter((el) => !el.matches(BLOCKS) && !el.closest(BLOCKS) && !INLINE.has(el.tagName));
  for (const el of containers) {
    let run: ChildNode[] = [];
    const flush = () => {
      if (run.some((n) => normaliseSpace(n.textContent ?? ''))) {
        const p = doc.createElement('p');
        run[0]!.before(p);
        for (const n of run) p.append(n);
      }
      run = [];
    };
    for (const node of Array.from(el.childNodes)) {
      const inline = node.nodeType === 3 || (node.nodeType === 1 && INLINE.has((node as Element).tagName));
      if (inline) run.push(node);
      else flush();
    }
    flush();
  }
}

/** Turns content HTML into ordered text blocks without duplicating nested text. */
export function toBlocks(contentHtml: string): Block[] {
  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const doc = dom.window.document;
  wrapLooseText(doc.body);
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
    const level = HEADING_TAGS.indexOf(el.tagName) + 1;
    if (!level && isLinkOnly(clone, text)) continue;
    blocks.push({ level, text });
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

/** Joins the innermost two section headings, e.g. "Exported goods › Timeframe for exporting". */
const headingLabel = (stack: Block[], title: string) => (stack.length ? stack.slice(-2).map((h) => h.text).join(' › ') : title);

export function chunkPage(url: string, title: string, blocks: Block[]): Passage[] {
  const prefix = sha256(url).slice(0, 8);
  const passages: Passage[] = [];
  const stack: Block[] = [];
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
    if (b.level) {
      flush();
      if (normaliseSpace(b.text) === normaliseSpace(title)) continue;
      while (stack.length && stack[stack.length - 1]!.level >= b.level) stack.pop();
      stack.push(b);
      heading = headingLabel(stack, title);
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

export function buildPage(url: string, html: string, fetchedAt = new Date().toISOString(), opts: ExtractOptions = {}): Page {
  const { title, contentHtml } = extractMain(html, url, opts);
  const passages = chunkPage(url, title, toBlocks(contentHtml));
  const fullText = passages.flatMap((p) => p.sentences.map((s) => s.text)).join('\n');
  return { url, title, fetchedAt, hash: sha256(fullText), passages };
}
