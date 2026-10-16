/**
 * 開発モード（コード）の成績を測る。run.cjs の開発モード版
 *
 * 使い方: NODE_PATH=<puppeteer-core のある node_modules> BASE=http://localhost:3100 RUNS=2 node bench/artifact-bench/run-dev.cjs [ラベル]
 * 結果: bench/artifact-bench/results/<日時>-dev-<ラベル>/ に results.json・summary.md・画面の写真・できたファイル
 *
 * 1 回の判定（run.cjs と同じ 4 つ。すべて満たせば「動いた」）
 *  - produced : ファイルができて、プレビューの画面が出た
 *  - noError  : プレビューの中でエラーが出なかった（開発モードのコンソールに出る error・エラー表示）
 *  - notBlank : 画面が真っ白（ほぼ1色）でない
 *  - survives : 画面の中の最初のボタンを1回押しても、エラーが出ない
 */
const p = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3100';
const RUNS = Number(process.env.RUNS || 1);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const label = process.argv[2] || 'run';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const prompts = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8')).filter((x) => !ONLY || ONLY.includes(x.id));
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
const outDir = path.join(__dirname, 'results', `${stamp}-dev-${label}`);
fs.mkdirSync(outDir, { recursive: true });

/** 画像（data URL）の色のばらつき。ほぼ0なら真っ白（1色） */
async function imageSpread(g, dataUrl) {
  return g.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sum2 += v * v; n++; }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  }, dataUrl);
}

/** SSE の complete から、できたファイル一覧 */
function filesFromSse(text) {
  const blocks = text.split('\n\n');
  let files = null;
  for (const b of blocks) {
    if (!b.startsWith('event: complete')) continue;
    const line = b.split('\n').find((l) => l.startsWith('data: '));
    try { files = JSON.parse(line.slice(6)).files; } catch { /* 読めない */ }
  }
  return files;
}

async function runOne(browser, item, runIndex) {
  const ctx = await browser.createBrowserContext();
  const g = await ctx.newPage();
  await g.setViewport({ width: 1280, height: 900 });
  // プレビューから親へ届くエラー（dev-preview-console の error）を集める
  await g.evaluateOnNewDocument(() => {
    // 返事（SSE）はページの中で文字として読む（外から読むと、文字の種類の指定がないため日本語が化ける）
    window.__benchSse = [];
    window.__benchVerify = [];
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.endsWith('/api/dev/chat')) res.clone().text().then((t) => window.__benchSse.push(t)).catch(() => {});
      // Toa の確かめ（3人の形のときだけ呼ばれる）
      if (url.endsWith('/api/dev/verify')) res.clone().json().then((j) => window.__benchVerify.push(j)).catch(() => {});
      return res;
    };
    window.__benchErrors = [];
    window.addEventListener('message', (e) => {
      const d = e.data || {};
      // React の助言（Warning: …）は動きを止めないので数えない（開発用の React だけが出す）
      if (d.type === 'dev-preview-console' && d.level === 'error' && !/^Warning: /.test((d.args || []).join(' '))) window.__benchErrors.push((d.args || []).join(' ').slice(0, 300));
      if (d.type === 'artifact-error') window.__benchErrors.push(`${d.kind}: ${d.message}`.slice(0, 300));
    });
  });
  let sse = '';
  let chatCalls = 0;
  let done = false;
  g.on('request', (r) => { if (r.url().endsWith('/api/dev/chat')) { chatCalls++; done = false; } });
  // 返事は流れてくるので、届き終わったとき（requestfinished）を「終わり」とする
  const onEnd = (r) => { if (r.url().endsWith('/api/dev/chat')) done = true; };
  g.on('requestfinished', onEnd);
  g.on('requestfailed', onEnd);

  const t0 = Date.now();
  const result = { id: item.id, tags: item.tags, run: runIndex, produced: false, noError: false, notBlank: false, survives: false, errors: [], seconds: 0 };
  const errors = [];
  try {
    // AUTOREPAIR=0：プレビューのエラーで自動で直さない（論文 006 の実験）
    await g.goto(BASE + '/' + (process.env.AUTOREPAIR === '0' ? '?autorepair=0' : ''), { waitUntil: 'networkidle2', timeout: 60_000 });
    await wait(800);
    await g.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'コード')?.click(); });
    await wait(1500);
    await g.click('.dev-chat-textarea');
    await g.type('.dev-chat-textarea', item.prompt);
    await g.click('.dev-chat-send-btn');
    for (let i = 0; i < 240 && !done; i++) await wait(1000);
    result.seconds = Math.round((Date.now() - t0) / 1000);
    // 自動で直す（もう一度 /api/dev/chat が呼ばれる）なら、それが終わるまで待つ。静かな時間が 15 秒続いたら終わり
    for (let i = 0, calm = 0, last = chatCalls; i < 400 && calm < 15; i++) {
      await wait(1000);
      const busy = !done || (await g.evaluate(() => [...document.querySelectorAll('.dev-live-status, .dev-repairing')].some((e) => /直しています|確かめています/.test(e.textContent || ''))));
      calm = busy || chatCalls !== last ? 0 : calm + 1;
      last = chatCalls;
    }
    sse = (await g.evaluate(() => window.__benchSse)).join('\n\n');
    // 返事をまるごと残す（見直しの判定・直しの前と後のファイルを、あとで調べるため。論文 006）
    fs.mkdirSync(path.join(outDir, 'sse'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'sse', `${item.id}-${runIndex}.txt`), sse);
    // 見直し役（Ren）の判定：ラウンドごとの合否と点
    result.reviews = sse.split('\n\n').filter((b) => b.startsWith('event: review')).map((b) => {
      try { const d = JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)); return { iteration: d.iteration, status: d.status, score: d.overallScore }; } catch { return null; }
    });
    result.chatCalls = chatCalls;
    result.finalSeconds = Math.round((Date.now() - t0) / 1000);
    // 返事（生成）ごとの、AI を呼んだ回数とトークン（complete の usage）
    result.generations = sse.split('\n\n').filter((b) => b.startsWith('event: complete')).map((b) => {
      try { return JSON.parse(b.split('\n').find((l) => l.startsWith('data: ')).slice(6)).usage || null; } catch { return null; }
    });
    // 作るか相談かの判定で、作らずに返したか
    result.replyOnly = !/event: complete/.test(sse);
    const verify = await g.evaluate(() => window.__benchVerify);
    result.toa = verify.map((v) => ({ checks: (v.checks || []).length, unmet: (v.checks || []).filter((c) => !c.ok).length, usage: v.usage || null, items: (v.checks || []).map((c) => ({ item: c.item, ok: c.ok })) }));
    result.toaFinal = await g.evaluate(() => [...document.querySelectorAll('.dev-live-status')].map((e) => e.innerText).join(' ').slice(0, 120));
    result.repairs = Math.max(0, chatCalls - 1);
    const files = filesFromSse(sse.split('event: complete').length > 2 ? sse.slice(sse.lastIndexOf('event: complete')) : sse);
    if (files) fs.writeFileSync(path.join(outDir, `${item.id}-${runIndex}.files.json`), JSON.stringify(files, null, 1));
    result.fileCount = files ? files.length : 0;

    // 最後のプレビューを開く（会話の中に画面が出ていればそれを使う）
    let iframeEl = await g.$('.dev-inline-preview iframe');
    if (!iframeEl) {
      const btn = await g.evaluateHandle(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.includes('プレビュー')).pop());
      if (btn.asElement()) { await btn.asElement().click(); await wait(1500); }
      iframeEl = await g.$('.dev-preview-iframe');
    }
    await g.evaluate(() => { window.__benchErrors = []; });
    if (iframeEl) {
      await wait(10_000); // 部品の読み込み・最初の描画を待つ
      const frame = await iframeEl.contentFrame();
      const inspect = async () => frame.evaluate(() => {
        const err = document.getElementById('preview-error') || document.getElementById('artifact-error');
        return {
          errorText: err ? err.textContent.slice(0, 300) : '',
          textLength: (document.body.innerText || '').trim().length,
          elements: document.body.querySelectorAll('*').length,
          buttons: document.querySelectorAll('button').length,
          loading: !!document.getElementById('preview-loading'),
        };
      });
      const before = await inspect();
      result.frame = before;
      result.produced = result.fileCount > 0 && !before.loading;
      if (before.errorText) errors.push('画面のエラー表示: ' + before.errorText);
      errors.push(...(await g.evaluate(() => window.__benchErrors)));
      const shot = await iframeEl.screenshot({ encoding: 'base64' });
      fs.writeFileSync(path.join(outDir, `${item.id}-${runIndex}.png`), Buffer.from(shot, 'base64'));
      result.spread = Math.round(await imageSpread(g, 'data:image/png;base64,' + shot) * 10) / 10;
      result.notBlank = result.spread > 4 || before.textLength > 20;
      result.noError = errors.length === 0;
      const errorsBeforeClick = errors.length;
      if (before.buttons > 0) {
        await g.evaluate(() => { window.__benchErrors = []; });
        try { await frame.evaluate(() => document.querySelector('button').click()); } catch (e) { errors.push('click: ' + e.message); }
        await wait(1500);
        const after = await inspect();
        if (after.errorText && after.errorText !== before.errorText) errors.push('押したあとのエラー表示: ' + after.errorText);
        errors.push(...(await g.evaluate(() => window.__benchErrors)));
      }
      result.survives = result.noError && errors.length === errorsBeforeClick;
    }
  } catch (e) {
    errors.push('runner: ' + e.message.slice(0, 200));
  }
  result.errors = [...new Set(errors)];
  result.ok = result.produced && result.noError && result.notBlank && result.survives;
  fs.writeFileSync(path.join(outDir, `${item.id}-${runIndex}.sse.txt`), sse);
  await ctx.close();
  return result;
}

(async () => {
  const browser = await p.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'] });
  const results = [];
  for (const item of prompts) {
    for (let i = 1; i <= RUNS; i++) {
      const r = await runOne(browser, item, i);
      results.push(r);
      console.log(`${r.ok ? 'OK ' : 'NG '} ${item.id}#${i} 出た:${r.produced ? '○' : '×'} エラーなし:${r.noError ? '○' : '×'} 真っ白でない:${r.notBlank ? '○' : '×'} 押しても平気:${r.survives ? '○' : '×'} ${r.seconds}秒 直した:${r.repairs ?? 0} ${r.errors[0] ? '／' + r.errors[0].slice(0, 80) : ''}`);
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ base: BASE, label, mode: 'dev', runs: RUNS, model: process.env.MODEL_LABEL || '', results }, null, 2));
    }
  }
  await browser.close();

  const rate = (xs, k) => (xs.length ? Math.round((xs.filter((x) => x[k]).length / xs.length) * 1000) / 10 : 0);
  const groups = { 全体: results, グラフ: results.filter((r) => r.tags.includes('chart')), '3D': results.filter((r) => r.tags.includes('3d')), その他: results.filter((r) => !r.tags.includes('chart') && !r.tags.includes('3d')) };
  let md = `# 開発モードの成績（${label}）\n\n- 日時: ${stamp}\n- 場所: ${BASE}\n- 1つのお題につき ${RUNS} 回\n\n| 分け方 | 回数 | 動いた | 画面が出た | エラーなし | 真っ白でない | 押しても平気 |\n|---|---|---|---|---|---|---|\n`;
  for (const [name, xs] of Object.entries(groups)) md += `| ${name} | ${xs.length} | ${rate(xs, 'ok')}% | ${rate(xs, 'produced')}% | ${rate(xs, 'noError')}% | ${rate(xs, 'notBlank')}% | ${rate(xs, 'survives')}% |\n`;
  md += `\n## うまくいかなかったもの\n\n` + results.filter((r) => !r.ok).map((r) => `- ${r.id}#${r.run}: ${r.produced ? '' : '画面が出なかった '}${r.errors.slice(0, 2).join(' / ')}`).join('\n') + '\n';
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  console.log('\n' + md);
  console.log('結果: ' + outDir);
  // ブラウザの後始末で止まることがあるので、確実に終える
  process.exit(0);
})();
