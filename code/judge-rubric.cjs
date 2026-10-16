/**
 * 論文 006：画面とコードを、いくつもの観点で 1〜5 点で採点する（元の論文の Utility・Writing Clarity に当たるもの）
 *
 * 使い方: JUDGE_MODELS=gemini-3.8-flash,gemini-3.7-flash node bench/artifact-bench/judge-rubric.cjs <結果のフォルダ> [<結果のフォルダ> ...]
 * - 審査役には、どの形（差し戻しあり・なし）で作ったかを渡さない
 * - 先に気づいたことを書かせてから点を付けさせる（元の論文の qualitative-first と同じ）
 * - 結果は results.json の各回に rubric[モデル名] として足す
 */
const fs = require('fs');
const path = require('path');

const MODELS = (process.env.JUDGE_MODELS || 'gemini-3.8-flash,gemini-3.7-flash').split(',').map((s) => s.trim()).filter(Boolean);
const env = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8');
const KEY = env.match(/^GEMINI_API_KEY="?([^"\n\\]+)/m)[1];
const prompts = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8')).map((p) => [p.id, p.prompt]));
const RUBRIC_VERSION = 1;
const DIMENSIONS = ['fulfillment', 'visual', 'usability', 'clarity', 'conciseness'];

const INSTRUCTION = `あなたは、AI のチームが作った小さなウェブアプリの審査役です。
利用者の頼みごと・できあがった画面の写真・アプリのコード（複数のファイル）を見て、次の5つの観点で 1〜5 点を付けてください。
- fulfillment（頼みの実現）：頼んだ機能がそろって、きちんと動くように作られているか
- visual（見た目の仕上がり）：崩れ・重なり・読みにくさがなく、整っているか（写真で判断）
- usability（使いやすさ）：操作が分かりやすく、迷わず使えるか
- clarity（コードの明快さ）：構成・名前・流れが分かりやすく、読みやすいか
- conciseness（コードの簡潔さ）：むだな重複・使われないコード・必要以上の守りの書き方（意味のない try/catch や確かめの重ね）がないか
見方:
- React・npm の部品・Chart.js・three.js などは、画面が自動で読み込む前提で見る（import の先がないことは減点しない）
- 写真に写らない動き（アニメーション・音・押したあと）は、コードで判断する。写真の下が黒く切れているのは撮影の都合
- 5 = とても良い、4 = 良い（小さな難点）、3 = ふつう（目立つ難点がある）、2 = 悪い、1 = とても悪い・動かない
まず、気づいたことを notes に短く書いてから、点を付けてください。
答えは次の JSON だけ: {"notes": "気づいたこと", "scores": {"fulfillment": 1-5, "visual": 1-5, "usability": 1-5, "clarity": 1-5, "conciseness": 1-5}}`;

function codeOf(dir, r) {
  const filesFile = path.join(dir, `${r.id}-${r.run}.files.json`);
  if (!fs.existsSync(filesFile)) return '';
  return JSON.parse(fs.readFileSync(filesFile, 'utf8')).map((f) => `// ===== ${f.path} =====\n${f.content}`).join('\n\n').slice(0, 60000);
}

async function rate(model, promptText, pngPath, code) {
  const body = {
    contents: [{ role: 'user', parts: [
      { text: `${INSTRUCTION}\n\n利用者の頼みごと: ${promptText}\n\nアプリのコード:\n${code || '（コードがありません）'}` },
      { inlineData: { mimeType: 'image/png', data: fs.readFileSync(pngPath).toString('base64') } },
    ] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).filter(Boolean).join('') || '{}';
      try {
        const parsed = JSON.parse(text);
        const one = Array.isArray(parsed) ? parsed[0] : parsed;
        const s = one?.scores || {};
        if (DIMENSIONS.every((d) => Number.isInteger(s[d]) && s[d] >= 1 && s[d] <= 5)) {
          return { scores: Object.fromEntries(DIMENSIONS.map((d) => [d, s[d]])), notes: String(one.notes || '').slice(0, 600) };
        }
      } catch { /* もう一度 */ }
      continue;
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  return null;
}

(async () => {
  for (const dir of process.argv.slice(2)) {
    const file = path.join(dir, 'results.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const r of data.results) {
      const png = path.join(dir, `${r.id}-${r.run}.png`);
      r.rubric = r.rubric || {};
      for (const model of MODELS) {
        if (r.rubric[model]?.version === RUBRIC_VERSION) continue;
        if (!r.produced || !fs.existsSync(png)) {
          r.rubric[model] = { version: RUBRIC_VERSION, scores: Object.fromEntries(DIMENSIONS.map((d) => [d, 1])), notes: '画面が出なかった' };
          continue;
        }
        const got = await rate(model, prompts[r.id], png, codeOf(dir, r));
        if (got) r.rubric[model] = { version: RUBRIC_VERSION, ...got };
        console.log(path.basename(dir), r.id, r.run, model, got ? JSON.stringify(got.scores) : '失敗');
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
      }
    }
  }
})();
