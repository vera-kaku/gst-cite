import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { crawl } from '../core/crawl.ts';
import { Store, newSnapshotId } from '../core/store.ts';
import { diffSnapshots, summariseUpdate } from '../core/updates.ts';
import { llmFromEnv } from '../core/llm.ts';
import type { GuidanceUpdate, Snapshot, SourceConfig } from '../core/types.ts';

export async function ingest(cfg: SourceConfig, store = new Store(), log = console.log) {
  const pages = await crawl(cfg, log);
  if (!pages.length) throw new Error('No pages were fetched. Check your network connection and the start URLs.');

  const snapshot: Snapshot = { id: newSnapshotId(), createdAt: new Date().toISOString(), source: cfg.name, pages };
  const prev = store.latest();
  let updates: GuidanceUpdate[] = diffSnapshots(prev, snapshot);

  const llm = llmFromEnv();
  if (llm && updates.length) {
    log(`Summarising ${updates.length} change(s) with ${llm.name}...`);
    updates = await Promise.all(
      updates.map(async (u) => {
        try {
          return await summariseUpdate(u, llm);
        } catch (e) {
          log(`could not summarise ${u.url}: ${(e as Error).message}`);
          return u;
        }
      }),
    );
  }

  store.writeSnapshot(snapshot);
  if (updates.length) store.appendUpdates(updates);

  const passages = pages.reduce((n, p) => n + p.passages.length, 0);
  log(`\nSaved snapshot ${snapshot.id}: ${pages.length} pages, ${passages} passages.`);
  if (!prev) log('This is the first snapshot, so it is the baseline for tracking future changes.');
  else {
    const count = (k: string) => updates.filter((u) => u.kind === k).length;
    log(`Compared with ${prev.id}: ${count('new')} new, ${count('changed')} changed, ${count('removed')} removed page(s).`);
  }
  return { snapshot, updates };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('cli', 'ingest.ts'));
if (isMain) {
  const { values } = parseArgs({ options: { config: { type: 'string', default: 'config/sources.json' }, 'max-pages': { type: 'string' } } });
  const cfg: SourceConfig = JSON.parse(fs.readFileSync(values.config!, 'utf8'));
  if (values['max-pages']) cfg.maxPages = Number(values['max-pages']);
  ingest(cfg).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
