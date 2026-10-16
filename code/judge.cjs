/**
 * 画面の写真を見て、頼んだとおりにできているかを採点する（審査役：作る役とは別の、より強いモデル）
 *
 * 使い方: node bench/artifact-bench/judge.cjs <結果のフォルダ>
 * 採点: 2 = 頼んだとおりにできている / 1 = 一部できていない・見た目が崩れている / 0 = 動いていない・頼んだものと違う
 * 結果は results.json の各回に judge として足し、summary.md に「審査で合格（2点）」の割合を足す
 */
const fs = require('fs');
const path = require('path');

const JUDGE_MODEL = process.env.JUDGE_MODEL || 'gemini-3.1-pro-preview';
const dir = process.argv[2];
const env = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8');
const KEY = env.match(/^GEMINI_API_KEY="?([^"\n\\]+)/m)[1];
const prompts = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8')).map((p) => [p.id, p.prompt]));

const JUDGE_VERSION = 4;
/** 同じ画面を何回採点して、真ん中の点を使うか（審査役の点のぶれを抑える） */
const JUDGE_SAMPLES = Number(process.env.JUDGE_SAMPLES || 3);
const INSTRUCTION = `あなたは、AI が作った小さなウェブ画面（アーティファクト）の審査役です。
利用者の頼みごと・できあがった画面の写真・その画面のコードを見て、頼んだとおりにできているかを採点してください。
見方:
- 見た目（崩れ・欠け・重なり・読めない文字・何も描かれていない）は、写真で判断する
- 機能（押す・ドラッグ・音・並べ替え・点数など、写真1枚では分からないもの）は、コードを読んで、きちんと作られているかで判断する
- 写真に写らない動き（アニメーション・音）は、コードで作られていれば減点しない
- この画面は、Chart.js・three.js・D3・GSAP・React を自動で読み込む場所で動く（import の行や <script src> がなくても、Chart / THREE / React などはそのまま使える）。読み込みの行がないことは減点しない
- 開発モード（複数のファイル）のときは、React の画面で、npm の部品は画面が自動で読み込む（import の先のファイルがなくても、読み込まれる前提で見る）
- 写真の下のほうが黒く切れているのは撮影の都合（縦に長い画面の写真の端）なので減点しない。そこに何があるかはコードで判断する
採点:
- 2: 頼んだものが、見た目も機能もきちんとできている（細かい好みの差は減点しない）
- 1: 形はできているが、頼んだものの一部が欠けている、見た目が崩れている、コードに不具合がある
- 0: 何も表示されていない、エラーで動かない、頼んだものと違う
答えは次の JSON だけで返してください: {"score": 0|1|2, "issues": ["見つけた問題を短く（日本語）", ...]}`;

/** 答えの中のアーティファクトのコード（長すぎる分は切る） */
function extractCode(answer) {
  const m = answer.match(/```(?:artifact:(?:html|react)|(?:html|react|jsx):\S)[^\n]*\n([\s\S]*?)\n```/);
  return m ? m[1].slice(0, 40000) : '';
}

async function judge(promptText, pngPath, code, sample = 0) {
  const body = {
    contents: [{ role: 'user', parts: [
      { text: `${INSTRUCTION}\n\n利用者の頼みごと: ${promptText}\n\n画面のコード:\n${code || '（コードが見つかりませんでした）'}` },
      { inlineData: { mimeType: 'image/png', data: fs.readFileSync(pngPath).toString('base64') } },
    ] }],
    generationConfig: { responseMimeType: 'application/json', temperature: sample === 0 ? 0 : 0.7 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') || '{}';
      try {
        const parsed = JSON.parse(text);
        // [{...}] の形で返ってくることがあるので、1つ目を使う
        const one = Array.isArray(parsed) ? parsed[0] : parsed;
        if (one && [0, 1, 2].includes(one.score)) return { score: one.score, issues: Array.isArray(one.issues) ? one.issues : [] };
      } catch { /* 下で読めなかったことにする */ }
      if (attempt < 2) continue;
      return { score: null, issues: ['審査の答えが読めませんでした'] };
    }
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  return { score: null, issues: ['審査に失敗しました'] };
}

(async () => {
  const file = path.join(dir, 'results.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const r of data.results) {
    const png = path.join(dir, `${r.id}-${r.run}.png`);
    if (!r.produced || !fs.existsSync(png)) { r.judge = { score: 0, issues: ['画面が出なかった'] }; continue; }
    if (r.judge?.version === JUDGE_VERSION && r.judge?.score != null) continue;
    if (r.judge && r.judge.version !== JUDGE_VERSION) r.judgeOld = r.judge; // 前の審査は残しておく
    const answerFile = path.join(dir, `${r.id}-${r.run}.answer.txt`);
    const repairedFile = path.join(dir, `${r.id}-${r.run}.repaired.txt`);
    // 自動で直したときは、直したあとのコードを見る
    const filesFile = path.join(dir, `${r.id}-${r.run}.files.json`);
    // 開発モードは複数のファイル。ファイル名を見出しにしてつなげる
    const code = fs.existsSync(repairedFile) ? fs.readFileSync(repairedFile, 'utf8').slice(0, 40000)
      : fs.existsSync(answerFile) ? extractCode(fs.readFileSync(answerFile, 'utf8'))
      : fs.existsSync(filesFile) ? JSON.parse(fs.readFileSync(filesFile, 'utf8')).map((f) => `// ===== ${f.path} =====\n${f.content}`).join('\n\n').slice(0, 60000) : '';
    const samples = [];
    for (let k = 0; k < JUDGE_SAMPLES; k++) samples.push(await judge(prompts[r.id], png, code, k));
    const scored = samples.filter((x) => x.score != null).sort((a, b) => a.score - b.score);
    r.judge = scored.length ? { ...scored[Math.floor((scored.length - 1) / 2)], samples: samples.map((x) => x.score) } : samples[0];
    r.judge.model = JUDGE_MODEL;
    r.judge.version = JUDGE_VERSION;
    console.log(`${r.judge.score} ${r.id}#${r.run} ${(r.judge.issues || []).join(' / ').slice(0, 100)}`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
  const xs = data.results;
  const pct = (f) => Math.round((xs.filter(f).length / xs.length) * 1000) / 10;
  const by = (tag) => xs.filter((r) => (tag === 'その他' ? !r.tags.includes('chart') && !r.tags.includes('3d') : r.tags.includes(tag)));
  let md = `\n## 審査 v${JUDGE_VERSION}（${JUDGE_MODEL} が写真とコードを見て採点）\n\n| 分け方 | 回数 | 合格（2点） | 1点 | 0点 | 自動の判定も審査も合格 |\n|---|---|---|---|---|---|\n`;
  for (const [name, ys] of [['全体', xs], ['グラフ', by('chart')], ['3D', by('3d')], ['その他', by('その他')]]) {
    const q = (f) => (ys.length ? Math.round((ys.filter(f).length / ys.length) * 1000) / 10 : 0);
    md += `| ${name} | ${ys.length} | ${q((r) => r.judge?.score === 2)}% | ${q((r) => r.judge?.score === 1)}% | ${q((r) => r.judge?.score === 0)}% | ${q((r) => r.ok && r.judge?.score === 2)}% |\n`;
  }
  fs.appendFileSync(path.join(dir, 'summary.md'), md);
  console.log(md, '\n全体の合格:', pct((r) => r.ok && r.judge?.score === 2) + '%');
})();
