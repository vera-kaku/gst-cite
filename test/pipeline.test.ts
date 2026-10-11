import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { serveSite } from './fixtures/site.ts';
import { ingest } from '../src/cli/ingest.ts';
import { Store } from '../src/core/store.ts';
import { PassageIndex } from '../src/core/search.ts';
import { answerQuestion } from '../src/core/answer.ts';
import { summariseUpdate } from '../src/core/updates.ts';
import { createApp } from '../src/server/index.ts';
import type { LLM } from '../src/core/llm.ts';

/** A fake model that returns whatever the test decides, built from the sentence ids it was shown. */
const fakeLLM = (reply: (prompt: string) => object): LLM => ({ name: 'fake', complete: async (_s, user) => JSON.stringify(reply(user)) });
const idFor = (prompt: string, startsWith: string) => prompt.match(new RegExp(`<([^>]+)> ${startsWith.replace(/[$.?]/g, '\\$&')}`))?.[1] ?? 'missing';

let dir: string;
let store: Store;
let site: Awaited<ReturnType<typeof serveSite>>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstcite-'));
  store = new Store(dir);
  site = await serveSite(1);
  await ingest(site.config, store, () => {});
});

afterAll(async () => {
  await site.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('answers', () => {
  it('retrieves the registration page for a threshold question', () => {
    const idx = new PassageIndex(store.latest()!);
    const hits = idx.search('When do I have to register for GST?');
    expect(hits[0]!.passage.url).toMatch(/registering-for-gst$/);
  });

  it('keeps supported points and drops ones with wrong figures or invented citations', async () => {
    const idx = new PassageIndex(store.latest()!);
    const llm = fakeLLM((p) => ({
      answerable: true,
      points: [
        { text: 'You must register for GST if your turnover was $60,000 or more in the last 12 months.', citations: [idFor(p, 'You must register for GST')] },
        { text: 'You must register if your turnover is over $75,000.', citations: [idFor(p, 'You must register for GST')] },
        { text: 'Registration is free.', citations: ['zzz-1.0'] },
      ],
    }));
    const r = await answerQuestion('When do I have to register for GST?', idx, llm);
    expect(r.answerable).toBe(true);
    expect(r.points.map((x) => x.text)).toEqual(['You must register for GST if your turnover was $60,000 or more in the last 12 months.']);
    expect(r.rejected).toHaveLength(2);
    const ev = r.evidence[r.points[0]!.citations[0]!]!;
    expect(ev.url).toMatch(/registering-for-gst$/);
    expect(ev.deepLink).toContain('#:~:text=');
  });

  it('reports no answer when the model says the sources do not cover the question', async () => {
    const idx = new PassageIndex(store.latest()!);
    const r = await answerQuestion('What are the income tax rates?', idx, fakeLLM(() => ({ answerable: false, points: [] })));
    expect(r.answerable).toBe(false);
    expect(r.points).toEqual([]);
  });

  it('declines before calling the model when the guidance does not cover the question', async () => {
    const idx = new PassageIndex(store.latest()!);
    let called = false;
    const llm: LLM = { name: 'spy', complete: async () => ((called = true), '{}') };
    const r = await answerQuestion('How much should I contribute to KiwiSaver?', idx, llm);
    expect(r.answerable).toBe(false);
    expect(called).toBe(false);
    expect(r.note).toMatch(/does not appear to cover/);
  });

  it('falls back to quoting source sentences when no model is configured', async () => {
    const idx = new PassageIndex(store.latest()!);
    const r = await answerQuestion('When are GST returns due?', idx, null);
    expect(r.mode).toBe('extractive');
    expect(r.points.some((x) => x.text.includes('28th of the month'))).toBe(true);
    expect(r.points.every((x) => x.status === 'verified')).toBe(true);
  });
});

describe('update tracking', () => {
  it('records the first snapshot as a baseline and detects changes on the next run', async () => {
    expect(store.readUpdates()).toEqual([]);
    site.setVersion(2);
    {
      const { updates } = await ingest(site.config, store, () => {});
      const byKind = Object.fromEntries(updates.map((u) => [new URL(u.url).pathname, u]));
      // The index page only gained a menu link, and the registration page only had its
      // key-dates widget change; neither is reported as a change.
      expect(Object.keys(byKind).sort()).toEqual(['/gst/filing-frequency', '/gst/remote-services']);
      expect(byKind['/gst/remote-services']!.kind).toBe('new');
      const filing = byKind['/gst/filing-frequency']!;
      expect(filing.kind).toBe('changed');
      expect(filing.removed.map((s) => s.text)).toEqual(['Most businesses file every 2 months.']);
      expect(filing.added.map((s) => s.text)).toEqual(['Two-monthly filing is the default if you do not choose an option.']);
      expect(store.readUpdates()).toHaveLength(2);
    }
  });

  it('summarises a change and keeps only points grounded in the changed sentences', async () => {
    const filing = store.readUpdates().find((u) => u.url.endsWith('/filing-frequency'))!;
    const llm = fakeLLM((p) => ({
      points: [
        { text: 'The guidance now says two-monthly filing is the default if you do not choose an option.', citations: [idFor(p, 'Two-monthly')] },
        { text: 'The 6-monthly turnover limit rose to $750,000.', citations: [idFor(p, 'Two-monthly')] },
      ],
    }));
    const u = await summariseUpdate(filing, llm);
    expect(u.summary!.points).toHaveLength(1);
    expect(u.summary!.rejected).toHaveLength(1);
  });
});

describe('API', () => {
  it('serves status, answers and updates', async () => {
    const server = createApp(store, null).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      expect(status.snapshot.pages).toBe(6);
      expect(status.llm).toBeNull();

      const ask = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Can I file GST every 6 months?' }) });
      const body = await ask.json();
      expect(body.points.some((p: { text: string }) => p.text.includes('$500,000'))).toBe(true);

      const bad = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '' }) });
      expect(bad.status).toBe(400);

      const updates = await (await fetch(`${base}/api/updates`)).json();
      expect(updates.updates).toHaveLength(2);
    } finally {
      server.close();
    }
  });
});

describe('evaluation', () => {
  it('scores answers, refusals and expected facts', async () => {
    const { runEval, toMarkdown } = await import('../src/cli/eval.ts');
    const idx = new PassageIndex(store.latest()!);
    const llm = fakeLLM((p) =>
      p.startsWith('Question: What are the income tax rates')
        ? { answerable: false, points: [] }
        : { answerable: true, points: [{ text: 'You must register for GST if your turnover was $60,000 or more in the last 12 months.', citations: [idFor(p, 'You must register for GST')] }] },
    );
    const res = await runEval(
      [
        { id: 'a', question: 'When do I have to register for GST?', inScope: true, expectFacts: ['60,000'], expectPages: ['/gst/registering-for-gst'] },
        { id: 'b', question: 'What are the income tax rates for individuals?', inScope: false },
      ],
      idx,
      llm,
    );
    expect(res.summary.answeredInScope).toBe('100% (1/1)');
    expect(res.summary.declinedOutOfScope).toBe('100% (1/1)');
    expect(res.summary.expectedFactsFound).toBe('100% (1/1)');
    expect(res.summary.retrievalHitAtK).toBe('100% (1/1)');
    expect(toMarkdown(idx.snapshot.id, res)).toContain('| When do I have to register for GST? | yes | yes | 1 | 0 | yes |');
  });
});
