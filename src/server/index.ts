import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from '../core/store.ts';
import { PassageIndex } from '../core/search.ts';
import { answerQuestion } from '../core/answer.ts';
import { llmFromEnv, type LLM } from '../core/llm.ts';

export function createApp(store = new Store(), llm: LLM | null = llmFromEnv()) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  let index: PassageIndex | null = null;
  let loadedId: string | null = null;
  const getIndex = () => {
    const ids = store.listSnapshotIds();
    const latestId = ids[ids.length - 1] ?? null;
    if (latestId && latestId !== loadedId) {
      index = new PassageIndex(store.readSnapshot(latestId));
      loadedId = latestId;
    }
    return index;
  };

  app.get('/api/status', (_req, res) => {
    const idx = getIndex();
    res.json({
      snapshot: idx ? { id: idx.snapshot.id, createdAt: idx.snapshot.createdAt, source: idx.snapshot.source, pages: idx.snapshot.pages.length, passages: idx.passages.size } : null,
      snapshots: store.listSnapshotIds().length,
      llm: llm?.name ?? null,
    });
  });

  app.post('/api/ask', async (req, res) => {
    const question = String(req.body?.question ?? '').trim();
    if (!question) return res.status(400).json({ error: 'Please enter a question.' });
    if (question.length > 500) return res.status(400).json({ error: 'Please keep questions under 500 characters.' });
    const idx = getIndex();
    if (!idx) return res.status(503).json({ error: 'No guidance has been indexed yet. Run "npm run ingest" first.' });
    try {
      res.json(await answerQuestion(question, idx, llm));
    } catch (e) {
      console.error(e);
      res.status(502).json({ error: 'The answer could not be generated. Please try again.' });
    }
  });

  app.get('/api/updates', (_req, res) => {
    res.json({ updates: store.readUpdates(), snapshots: store.listSnapshotIds() });
  });

  const webDir = path.resolve('dist/web');
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('server', 'index.ts'));
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const llm = llmFromEnv();
  createApp(new Store(), llm).listen(port, () => {
    console.log(`GST Cite running on http://localhost:${port} (${llm ? llm.name : 'extractive mode, no LLM key set'})`);
  });
}
