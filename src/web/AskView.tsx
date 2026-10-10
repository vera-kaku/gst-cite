import { useMemo, useRef, useState } from 'react';
import type { AnswerResult } from '../core/types.ts';
import type { Status } from './App.tsx';
import { Figures } from './Figures.tsx';

const EXAMPLES = ['When do I have to register for GST?', 'Can I file GST returns every 6 months?', 'When is the GST return for the March period due?', 'What has to be on an invoice over $1,000?'];

export function AskView({ status }: { status: Status | null }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const sourcesRef = useRef<HTMLOListElement>(null);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    setActive(null);
    try {
      const res = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  // Footnote numbers follow the order in which verified points first cite each sentence.
  const footnotes = useMemo(() => {
    const order: string[] = [];
    for (const p of result?.points ?? []) for (const c of p.citations) if (!order.includes(c) && result?.evidence[c]) order.push(c);
    return order;
  }, [result]);

  const focusSource = (id: string) => {
    setActive(id);
    sourcesRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const noIndex = status && !status.snapshot;

  return (
    <section className="ask">
      <form
        className="question"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <label htmlFor="q" className="question-label">
          Your GST question
        </label>
        <div className="question-row">
          <textarea
            id="q"
            rows={2}
            maxLength={500}
            value={question}
            placeholder="For example, when do I have to register for GST?"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
          />
          <button type="submit" className="primary" disabled={busy || !question.trim() || !!noIndex}>
            {busy ? 'Checking sources' : 'Ask'}
          </button>
        </div>
      </form>

      {noIndex && <p className="notice">No guidance has been indexed yet. Run npm run ingest, then reload this page.</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {!result && !busy && !error && !noIndex && (
        <div className="examples">
          <p>Try one of these</p>
          <ul>
            {EXAMPLES.map((q) => (
              <li key={q}>
                <button className="example" onClick={() => ask(q)}>
                  {q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="result" aria-live="polite">
          <article className="answer">
            <h2 className="answer-q">{result.question}</h2>
            {result.mode === 'extractive' && <p className="mode">Quoting the closest source sentences, because no language model is configured.</p>}
            {result.answerable ? (
              <ul className="points">
                {result.points.map((p, i) => (
                  <li key={i} className="point">
                    <span className="point-text">
                      <Figures text={p.text} />
                    </span>
                    <span className="cites">
                      {p.citations
                        .filter((c) => footnotes.includes(c))
                        .map((c) => (
                          <button key={c} className={active === c ? 'cite active' : 'cite'} onClick={() => focusSource(c)} aria-label={`Show source ${footnotes.indexOf(c) + 1}`}>
                            {footnotes.indexOf(c) + 1}
                          </button>
                        ))}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="unanswered">{result.note ?? 'The indexed guidance does not answer this question.'}</p>
            )}
            {result.answerable && result.note && <p className="caveat">{result.note}</p>}

            {result.rejected.length > 0 && (
              <details className="removed">
                <summary>
                  {result.rejected.length} drafted {result.rejected.length === 1 ? 'point was' : 'points were'} removed because the sources did not support {result.rejected.length === 1 ? 'it' : 'them'}
                </summary>
                <ul>
                  {result.rejected.map((p, i) => (
                    <li key={i}>
                      <s>{p.text}</s>
                      <span className="reason">{p.reasons.join('; ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <details className="searched">
              <summary>{result.retrieved.length} passages searched</summary>
              <ol>
                {result.retrieved.map((r) => (
                  <li key={r.passageId}>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.pageTitle}
                    </a>
                    {r.heading !== r.pageTitle && <span className="muted">, {r.heading}</span>}
                  </li>
                ))}
              </ol>
            </details>
          </article>

          {footnotes.length > 0 && (
            <aside className="sources" aria-label="Sources">
              <h2>Sources</h2>
              <ol ref={sourcesRef}>
                {footnotes.map((id, i) => {
                  const ev = result.evidence[id]!;
                  return (
                    <li key={id} data-id={id} className={active === id ? 'source active' : 'source'}>
                      <span className="source-n">{i + 1}</span>
                      <blockquote>
                        <Figures text={ev.text} />
                      </blockquote>
                      <p className="source-where">
                        {ev.pageTitle}
                        {ev.heading !== ev.pageTitle && <>, {ev.heading}</>}
                      </p>
                      <a href={ev.deepLink} target="_blank" rel="noreferrer">
                        Open this sentence in the guidance
                      </a>
                    </li>
                  );
                })}
              </ol>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
