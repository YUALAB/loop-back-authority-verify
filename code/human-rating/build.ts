/**
 * 論文 006：人が目で見比べる採点ページを作る（差し戻しなし A と、意見だけ B を、同じお題・同じ回で並べる）
 * 使い方: npx tsx bench/artifact-bench/human-rating/build.ts
 * - アプリは YUA のプレビューと同じ組み立て（buildPreviewHtml）で、さわって試せる HTML にする
 * - どちらが A／B かは key.json（配る場所の外）にだけ残す。左右は乱数で入れ替える
 */
import fs from 'fs';
import path from 'path';
import { buildPreviewHtml } from '@/components/dev/preview/iframe/html-builder';

const ROOT = path.join(__dirname, '..');
const OUT = __dirname;
const DIRS = { A: '202610152355-dev-p6-A', B: '202610152355-dev-p6-B' } as const;
const prompts: { id: string; prompt: string }[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts.json'), 'utf8'));

// 決まった並びになる乱数（やり直しても同じ組になる）
let seed = 6006;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const lang = (p: string) => ({ tsx: 'tsx', ts: 'typescript', jsx: 'jsx', js: 'javascript', css: 'css', html: 'html', json: 'json' } as Record<string, string>)[p.split('.').pop() || ''] || 'text';
const results = Object.fromEntries(Object.entries(DIRS).map(([arm, d]) => [arm, JSON.parse(fs.readFileSync(path.join(ROOT, 'results', d, 'results.json'), 'utf8')).results]));
const filesOf = (arm: 'A' | 'B', id: string, run: number) => {
  const f = path.join(ROOT, 'results', DIRS[arm], `${id}-${run}.files.json`);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as { path: string; content: string; language?: string }[]).map((x) => ({ ...x, language: x.language || lang(x.path) })) : null;
};

const pairs: object[] = [];
const key: object[] = [];
for (const p of prompts) {
  const runs = [1, 2].filter((run) => (['A', 'B'] as const).every((arm) => results[arm].find((r: { id: string; run: number; produced: boolean }) => r.id === p.id && r.run === run)?.produced && filesOf(arm, p.id, run)));
  if (!runs.length) { console.log('どちらかが画面なし:', p.id); continue; }
  const run = runs[Math.floor(rand() * runs.length)];
  const leftIsA = rand() < 0.5;
  const n = String(pairs.length + 1).padStart(2, '0');
  for (const [side, arm] of [['L', leftIsA ? 'A' : 'B'], ['R', leftIsA ? 'B' : 'A']] as const) {
    fs.writeFileSync(path.join(OUT, 'apps', `${n}-${side}.html`), buildPreviewHtml(filesOf(arm, p.id, run)!));
  }
  pairs.push({ n, prompt: p.prompt });
  key.push({ n, id: p.id, run, L: leftIsA ? 'A' : 'B', R: leftIsA ? 'B' : 'A' });
}
// 並び順もお題の順にならないよう混ぜる
const order = pairs.map((_, i) => i).sort(() => rand() - 0.5);
fs.writeFileSync(path.join(OUT, 'apps', 'pairs.json'), JSON.stringify(order.map((i) => pairs[i])));
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));
console.log('組の数:', pairs.length);
