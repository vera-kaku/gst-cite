import { useEffect, useState } from 'react';
import { AskView } from './AskView.tsx';
import { UpdatesView } from './UpdatesView.tsx';

export interface Status {
  snapshot: { id: string; createdAt: string; source: string; pages: number; passages: number } | null;
  snapshots: number;
  llm: string | null;
}

type Tab = 'ask' | 'changes';

import { formatDate } from './format.ts';

export function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash === '#changes' ? 'changes' : 'ask'));
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', t === 'changes' ? '#changes' : '#');
  };

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">GST</span>
          <span className="brand-name">Cite</span>
        </div>
        <p className="tagline">Answers from Inland Revenue GST guidance. Every point is checked against the sentence it cites.</p>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === 'ask' ? 'tab active' : 'tab'} aria-current={tab === 'ask'} onClick={() => go('ask')}>
            Ask a question
          </button>
          <button className={tab === 'changes' ? 'tab active' : 'tab'} aria-current={tab === 'changes'} onClick={() => go('changes')}>
            Guidance changes
          </button>
        </nav>
      </header>

      <main className="content">{tab === 'ask' ? <AskView status={status} /> : <UpdatesView />}</main>

      <footer className="colophon">
        {status?.snapshot ? (
          <p>
            Indexed {status.snapshot.pages} pages of {status.snapshot.source}, fetched {formatDate(status.snapshot.createdAt)}.{' '}
            {status.llm ? `Answers drafted by ${status.llm}.` : 'No language model configured, so answers quote the closest source sentences.'}
          </p>
        ) : (
          <p>No guidance indexed yet. Run npm run ingest to fetch it.</p>
        )}
        <p>A personal research project, not tax advice. Always read the linked guidance before relying on an answer.</p>
      </footer>
    </div>
  );
}
