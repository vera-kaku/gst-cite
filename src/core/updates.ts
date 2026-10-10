import { diffArrays } from 'diff';
import type { GuidanceUpdate, Page, Sentence, Snapshot } from './types.ts';
import type { LLM } from './llm.ts';
import { parseJsonObject } from './llm.ts';
import { checkPoints, type RawPoint } from './verify.ts';
import { sha256 } from './text.ts';

const sentencesOf = (p: Page): Sentence[] => p.passages.flatMap((x) => x.sentences);

/** Compares two snapshots page by page and returns new, removed and changed pages. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): GuidanceUpdate[] {
  const detectedAt = next.createdAt;
  const before = new Map((prev?.pages ?? []).map((p) => [p.url, p]));
  const after = new Map(next.pages.map((p) => [p.url, p]));
  const out: GuidanceUpdate[] = [];
  const mk = (kind: GuidanceUpdate['kind'], url: string, title: string, added: Sentence[], removed: Sentence[]): GuidanceUpdate => ({
    id: sha256(`${next.id}|${url}`).slice(0, 12),
    kind,
    url,
    title,
    fromSnapshot: prev?.id ?? null,
    toSnapshot: next.id,
    detectedAt,
    added,
    removed,
  });

  // The first snapshot is a baseline, not a list of "new" guidance.
  if (!prev) return [];

  for (const [url, page] of after) {
    const old = before.get(url);
    if (!old) {
      out.push(mk('new', url, page.title, sentencesOf(page), []));
      continue;
    }
    if (old.hash === page.hash) continue;
    const a = sentencesOf(old);
    const b = sentencesOf(page);
    const parts = diffArrays(
      a.map((s) => s.text),
      b.map((s) => s.text),
    );
    const added: Sentence[] = [];
    const removed: Sentence[] = [];
    let ia = 0;
    let ib = 0;
    for (const part of parts) {
      const n = part.count ?? part.value.length;
      if (part.added) {
        added.push(...b.slice(ib, ib + n).map((s) => ({ ...s, id: `new:${s.id}` })));
        ib += n;
      } else if (part.removed) {
        removed.push(...a.slice(ia, ia + n).map((s) => ({ ...s, id: `old:${s.id}` })));
        ia += n;
      } else {
        ia += n;
        ib += n;
      }
    }
    if (added.length || removed.length) out.push(mk('changed', url, page.title, added, removed));
  }
  for (const [url, page] of before) {
    if (!after.has(url)) out.push(mk('removed', url, page.title, [], sentencesOf(page)));
  }
  return out;
}

export const UPDATE_SYSTEM = `You summarise changes to New Zealand Inland Revenue GST guidance for tax professionals.
You are given sentences REMOVED from a page (ids start with "old:") and sentences ADDED (ids start with "new:").

Write up to 4 short points:
- what changed, comparing old and new wording where both exist;
- which kinds of taxpayers or firms might be affected, only if the sentences make this clear.
Every point must cite the ids it relies on. Keep amounts, rates and dates exactly as written.
Ignore purely cosmetic changes (punctuation, formatting); if that is all that changed, return no points.

Reply with JSON only: {"points": [{"text": "...", "citations": ["new:..."]}]}`;

export async function summariseUpdate(u: GuidanceUpdate, llm: LLM): Promise<GuidanceUpdate> {
  const limit = 60;
  const allowed = new Map<string, string>();
  const fmt = (label: string, list: Sentence[]) =>
    list.length
      ? `${label}:\n` +
        list
          .slice(0, limit)
          .map((s) => {
            allowed.set(s.id, s.text);
            return `<${s.id}> ${s.text}`;
          })
          .join('\n')
      : `${label}: (none)`;
  const user = `Page: ${u.title}\n${u.url}\nChange type: ${u.kind}\n\n${fmt('REMOVED', u.removed)}\n\n${fmt('ADDED', u.added)}`;
  const parsed = parseJsonObject<{ points?: RawPoint[] }>(await llm.complete(UPDATE_SYSTEM, user));
  const { verified, rejected } = checkPoints(parsed.points ?? [], allowed);
  return { ...u, summary: { points: verified, rejected } };
}
