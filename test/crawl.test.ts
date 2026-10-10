import { crawl, normaliseUrl, inScope } from '../src/core/crawl.ts';
import { serveSite } from './fixtures/site.ts';

describe('normaliseUrl and inScope', () => {
  const cfg = { name: '', startUrls: [], allowPrefixes: ['https://www.ird.govt.nz/gst'], maxPages: 1, delayMs: 0, userAgent: '' };
  it('strips query strings, fragments and trailing slashes', () => {
    expect(normaliseUrl('/gst/filing/?a=1#x', 'https://www.ird.govt.nz/gst')).toBe('https://www.ird.govt.nz/gst/filing');
  });
  it('accepts only pages under the prefix and skips documents', () => {
    expect(inScope('https://www.ird.govt.nz/gst/registering', cfg)).toBe(true);
    expect(inScope('https://www.ird.govt.nz/gst', cfg)).toBe(true);
    expect(inScope('https://www.ird.govt.nz/gstx', cfg)).toBe(false);
    expect(inScope('https://www.ird.govt.nz/income-tax', cfg)).toBe(false);
    expect(inScope('https://www.ird.govt.nz/gst/guide.pdf', cfg)).toBe(false);
  });
});

describe('crawl', () => {
  it('fetches in-scope pages, respects robots.txt and extracts main content only', async () => {
    const site = await serveSite(1);
    try {
      const pages = await crawl(site.config, () => {});
      const paths = pages.map((p) => new URL(p.url).pathname).sort();
      expect(paths).toEqual(['/gst', '/gst/filing-frequency', '/gst/registering-for-gst', '/gst/taxable-supply-information']);
      expect(site.requested).not.toContain('/gst/private');
      expect(site.requested).not.toContain('/income-tax');
      expect(site.requested).not.toContain('/gst/guide.pdf');

      const all = pages.flatMap((p) => p.passages.flatMap((x) => x.sentences.map((s) => s.text))).join('\n');
      expect(all).not.toMatch(/Copyright notice|0800 000 000|KiwiSaver/);

      const reg = pages.find((p) => p.url.endsWith('/registering-for-gst'))!;
      expect(reg.title).toBe('Registering for GST');
      expect(reg.passages.map((p) => p.heading)).toEqual(['Who must register', 'Registering voluntarily', 'What you need to register']);
      expect(reg.passages[0]!.sentences.map((s) => s.text)).toEqual([
        'You must register for GST if your turnover was $60,000 or more in the last 12 months.',
        'You must also register if you expect your turnover to be $60,000 or more in the next 12 months.',
      ]);
      expect(reg.passages[2]!.sentences.map((s) => s.text)).toContain('your bank account number');

      const filing = pages.find((p) => p.url.endsWith('/filing-frequency'))!;
      expect(filing.passages.flatMap((p) => p.sentences.map((s) => s.text))).toContain('30 November | 15 January');
    } finally {
      await site.close();
    }
  });
});
