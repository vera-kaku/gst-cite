import { JSDOM } from 'jsdom';
import robotsParser from 'robots-parser';
import type { Page, SourceConfig } from './types.ts';
import { buildPage } from './chunk.ts';

const SKIP_EXT = /\.(pdf|docx?|xlsx?|csv|zip|png|jpe?g|gif|svg|mp4|mp3)$/i;

export function normaliseUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    u.search = '';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

export function inScope(url: string, cfg: SourceConfig): boolean {
  return cfg.allowPrefixes.some((p) => url === p || url.startsWith(p.endsWith('/') ? p : p + '/')) && !SKIP_EXT.test(url);
}

export function extractLinks(html: string, pageUrl: string, cfg: SourceConfig): string[] {
  const doc = new JSDOM(html, { url: pageUrl }).window.document;
  const links = new Set<string>();
  doc.querySelectorAll('a[href]').forEach((a) => {
    const u = normaliseUrl(a.getAttribute('href') ?? '', pageUrl);
    if (u && inScope(u, cfg)) links.add(u);
  });
  return [...links];
}

export interface CrawlLog {
  (msg: string): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Breadth-first crawl limited to the configured prefixes. Respects robots.txt,
 * waits between requests and stops at maxPages.
 */
export async function crawl(cfg: SourceConfig, log: CrawlLog = console.log, fetchImpl: typeof fetch = fetch): Promise<Page[]> {
  const origin = new URL(cfg.startUrls[0]!).origin;
  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const res = await fetchImpl(`${origin}/robots.txt`, { headers: { 'User-Agent': cfg.userAgent }, signal: AbortSignal.timeout(30_000) });
    if (res.ok) robots = robotsParser(`${origin}/robots.txt`, await res.text());
  } catch {
    log('Could not read robots.txt, continuing with the configured scope only.');
  }

  log(`Fetching up to ${cfg.maxPages} pages from ${cfg.startUrls.join(', ')}, one every ${cfg.delayMs / 1000}s. This can take a few minutes.`);
  const queue = cfg.startUrls.map((u) => normaliseUrl(u, u)!).filter(Boolean);
  const seen = new Set(queue);
  const pages: Page[] = [];

  while (queue.length && pages.length < cfg.maxPages) {
    const url = queue.shift()!;
    if (robots && robots.isAllowed(url, cfg.userAgent) === false) {
      log(`skip (robots.txt) ${url}`);
      continue;
    }
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': cfg.userAgent, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('html')) {
        log(`skip (${res.status} ${type.split(';')[0]}) ${url}`);
      } else {
        const finalUrl = normaliseUrl(res.url || url, url) ?? url;
        const html = await res.text();
        const page = buildPage(finalUrl, html, undefined, { removeSelectors: cfg.removeSelectors });
        const words = page.passages.reduce((n, p) => n + p.sentences.reduce((m, s) => m + s.text.split(' ').length, 0), 0);
        if (words < 30) log(`warning: only ${words} words extracted from ${finalUrl}; the page may render its content with JavaScript.`);
        if (!pages.some((p) => p.url === finalUrl)) pages.push(page);
        log(`ok [${pages.length}] ${page.title} (${page.passages.length} passages) ${finalUrl}`);
        for (const link of extractLinks(html, finalUrl, cfg)) {
          if (!seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    } catch (e) {
      log(`error ${url}: ${(e as Error).message}`);
    }
    if (queue.length && cfg.delayMs > 0) await sleep(cfg.delayMs);
  }
  return pages;
}
