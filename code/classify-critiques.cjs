/**
 * 論文 006：見直し役（Ren）の指摘を、種類に振り分ける（gemini-3.8-flash。まとめて60件ずつ）
 * 使い方: node bench/artifact-bench/classify-critiques.cjs <指摘の JSON> <出力の JSON>
 */
const fs = require('fs');
const path = require('path');
const env = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8');
const KEY = env.match(/^GEMINI_API_KEY="?([^"\n\\]+)/m)[1];
const MODEL = process.env.JUDGE_MODEL || 'gemini-3.8-flash';
const CATS = ['bug', 'missing', 'extra', 'defensive', 'ux', 'code'];
const INSTRUCTION = `AI のチームでウェブアプリを作ったとき、見直し役が作り手に出した指摘の一覧です。それぞれを、次のどれか1つに振り分けてください。
- bug：このままだと動かない・間違った動きをする（実際に動かせば確かめられる不具合）
- missing：利用者が頼んだ機能が欠けている
- extra：利用者が頼んでいない機能や拡張の提案（ダークモード・将来の拡張性・追加の機能など）
- defensive：想定外の入力・空のデータ・エラーへの備えを足す提案（いまの使い方では問題は起きない）
- ux：見た目・使いやすさ・アクセシビリティ・スマホ対応の提案
- code：コードの書き方・型・名前・構成・保守性（動きは変わらない）
答えは JSON だけ：{"labels": ["カテゴリ", ...]}（指摘と同じ順・同じ数）`;

async function classify(batch) {
  const list = batch.map((x, i) => `${i + 1}. [${x.file}] ${x.issue}`).join('\n');
  const body = { contents: [{ role: 'user', parts: [{ text: `${INSTRUCTION}\n\n${list}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } };
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
    if (res.ok) {
      const j = await res.json();
      try {
        const labels = JSON.parse(j.candidates[0].content.parts.filter((p) => !p.thought).map((p) => p.text).join('')).labels;
        if (Array.isArray(labels) && labels.length === batch.length && labels.every((l) => CATS.includes(l))) return labels;
      } catch { /* もう一度 */ }
    } else await new Promise((r) => setTimeout(r, 4000 * (a + 1)));
  }
  return batch.map(() => null);
}

(async () => {
  const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  for (let i = 0; i < items.length; i += 60) {
    const batch = items.slice(i, i + 60);
    const labels = await classify(batch);
    batch.forEach((x, k) => { x.label = labels[k]; });
    console.log(i, labels.filter(Boolean).length, '/', batch.length);
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(items, null, 1));
})();
