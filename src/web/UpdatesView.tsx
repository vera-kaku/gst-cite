import { useEffect, useState } from 'react';
import type { GuidanceUpdate } from '../core/types.ts';
import { formatDate } from './format.ts';
import { Figures } from './Figures.tsx';

const KIND_LABEL: Record<GuidanceUpdate['kind'], string> = { new: 'New page', changed: 'Changed', removed: 'Removed' };

export function UpdatesView() {
  const [data, setData] = useState<{ updates: GuidanceUpdate[]; snapshots: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/updates')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading changes</p>;

  if (!data.updates.length) {
    return (
      <section className="changes-empty">
        <h2>No changes detected yet</h2>
        <p>
          {data.snapshots.length <= 1
            ? 'Each run of npm run ingest saves a copy of the guidance. The first copy is the baseline; changes appear here after the next run finds pages that are new, edited or removed.'
            : 'The guidance has not changed between the saved copies.'}
        </p>
      </section>
    );
  }

  const groups = new Map<string, GuidanceUpdate[]>();
  for (const u of data.updates) groups.set(u.detectedAt, [...(groups.get(u.detectedAt) ?? []), u]);

  return (
    <section className="changes">
      {[...groups.entries()].map(([when, items]) => (
        <div key={when} className="change-run">
          <h2>Found on {formatDate(when)}</h2>
          <ul>
            {items.map((u) => (
              <li key={u.id} className={`change ${u.kind}`}>
                <div className="change-head">
                  <span className="kind">{KIND_LABEL[u.kind]}</span>
                  <a href={u.url} target="_blank" rel="noreferrer">
                    {u.title}
                  </a>
                </div>
                {u.summary && u.summary.points.length > 0 && (
                  <ul className="change-summary">
                    {u.summary.points.map((p, i) => (
                      <li key={i}>
                        <Figures text={p.text} />
                      </li>
                    ))}
                  </ul>
                )}
                {u.kind === 'changed' && (
                  <div className="diff" aria-label="Wording that changed">
                    {u.removed.map((s) => (
                      <p key={s.id} className="del">
                        <span className="sr">Removed: </span>
                        <Figures text={s.text} />
                      </p>
                    ))}
                    {u.added.map((s) => (
                      <p key={s.id} className="ins">
                        <span className="sr">Added: </span>
                        <Figures text={s.text} />
                      </p>
                    ))}
                  </div>
                )}
                {u.kind !== 'changed' && !u.summary?.points.length && (
                  <p className="muted">
                    {u.kind === 'new' ? `${u.added.length} sentences on a page that was not there before.` : 'This page is no longer in the guidance section.'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
