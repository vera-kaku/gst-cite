import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../core/store.ts';
import { PassageIndex } from '../core/search.ts';
import { answerQuestion } from '../core/answer.ts';
import { llmFromEnv, type LLM } from '../core/llm.ts';
import type { AnswerResult } from '../core/types.ts';

export interface EvalQuestion {
  id: string;
  question: string;
  inScope: boolean;
  expectFacts?: string[];
  expectUrlContains?: string[];
}

export interface EvalRow {
  q: EvalQuestion;
  result?: AnswerResult;
  error?: string;
  retrievalHit: boolean | null;
  factsFound: boolean | null;
  correctScope: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[$,]/g, '');

export async function runEval(questions: EvalQuestion[], index: PassageIndex, llm: LLM | null, k = 5) {
  const rows: EvalRow[] = [];
  for (const q of questions) {
    try {
      const result = await answerQuestion(q.question, index, llm);
      const urls = result.retrieved.slice(0, k).map((r) => r.url);
      const retrievalHit = q.expectUrlContains?.length ? q.expectUrlContains.some((frag) => urls.some((u) => u.includes(frag))) : null;
      const answerText = norm(result.points.map((p) => p.text).join(' '));
      const factsFound = q.expectFacts?.length ? q.expectFacts.every((f) => answerText.includes(norm(f))) : null;
      rows.push({ q, result, retrievalHit, factsFound, correctScope: result.answerable === q.inScope });
    } catch (e) {
      rows.push({ q, error: (e as Error).message, retrievalHit: null, factsFound: null, correctScope: false });
    }
  }

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}% (${n}/${d})` : 'n/a');
  const inScope = rows.filter((r) => r.q.inScope);
  const outScope = rows.filter((r) => !r.q.inScope);
  const verified = rows.reduce((n, r) => n + (r.result?.points.length ?? 0), 0);
  const rejected = rows.reduce((n, r) => n + (r.result?.rejected.length ?? 0), 0);
  const labelled = rows.filter((r) => r.retrievalHit !== null);
  const withFacts = rows.filter((r) => r.factsFound !== null);

  const summary = {
    mode: llm ? llm.name : 'extractive (no model)',
    answeredInScope: pct(inScope.filter((r) => r.result?.answerable).length, inScope.length),
    declinedOutOfScope: llm ? pct(outScope.filter((r) => r.result && !r.result.answerable).length, outScope.length) : 'n/a in extractive mode',
    pointsPassingChecks: pct(verified, verified + rejected),
    expectedFactsFound: pct(withFacts.filter((r) => r.factsFound).length, withFacts.length),
    retrievalHitAtK: pct(labelled.filter((r) => r.retrievalHit).length, labelled.length),
    errors: rows.filter((r) => r.error).length,
  };
  return { rows, summary };
}

export function toMarkdown(snapshotId: string, s: Awaited<ReturnType<typeof runEval>>): string {
  const yn = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
  const lines = [
    `# Evaluation report`,
    ``,
    `Snapshot: ${snapshotId}  `,
    `Mode: ${s.summary.mode}  `,
    `Run: ${new Date().toISOString()}`,
    ``,
    `| Measure | Result |`,
    `| --- | --- |`,
    `| In-scope questions answered | ${s.summary.answeredInScope} |`,
    `| Out-of-scope questions declined | ${s.summary.declinedOutOfScope} |`,
    `| Drafted points that passed the citation checks | ${s.summary.pointsPassingChecks} |`,
    `| Expected facts present in the answer | ${s.summary.expectedFactsFound} |`,
    `| Expected page in top 5 results | ${s.summary.retrievalHitAtK} |`,
    `| Errors | ${s.summary.errors} |`,
    ``,
    `## Questions`,
    ``,
    `| Question | In scope | Answered | Points kept | Points removed | Facts found | Top page |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
    ...s.rows.map((r) => {
      const top = r.result?.retrieved[0];
      return `| ${r.q.question} | ${r.q.inScope ? 'yes' : 'no'} | ${r.error ? `error: ${r.error}` : yn(r.result?.answerable ?? null)} | ${r.result?.points.length ?? ''} | ${r.result?.rejected.length ?? ''} | ${yn(r.factsFound)} | ${top ? top.pageTitle : ''} |`;
    }),
    ``,
    `## Removed points`,
    ``,
    ...s.rows.flatMap((r) => (r.result?.rejected ?? []).map((p) => `- **${r.q.id}**: "${p.text}" (${p.reasons.join('; ')})`)),
  ];
  return lines.join('\n') + '\n';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('cli', 'eval.ts'));
if (isMain) {
  const { values } = parseArgs({ options: { file: { type: 'string', default: 'eval/questions.json' }, label: { type: 'boolean', default: false }, out: { type: 'string', default: 'eval/report.md' } } });
  const snap = new Store().latest();
  if (!snap) {
    console.error('No snapshot found. Run "npm run ingest" first.');
    process.exit(1);
  }
  const index = new PassageIndex(snap);
  const { questions } = JSON.parse(fs.readFileSync(values.file!, 'utf8')) as { questions: EvalQuestion[] };
  if (values.label) {
    for (const q of questions) {
      console.log(`\n${q.id}: ${q.question}`);
      for (const h of index.search(q.question, 3)) console.log(`  ${h.score.toFixed(1)}  ${h.passage.url}  (${h.passage.heading})`);
    }
  } else {
    const llm = llmFromEnv();
    console.log(`Running ${questions.length} questions in ${llm ? llm.name : 'extractive'} mode...`);
    const res = await runEval(questions, index, llm);
    fs.writeFileSync(values.out!, toMarkdown(snap.id, res));
    console.table(res.summary);
    console.log(`Full report written to ${values.out}`);
  }
}
