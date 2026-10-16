"""
論文 006 の集計：差し戻しの権限（意見・確かめ）の 2×2 を、同じお題・同じ回で比べる

使い方: <scipy などのある python> bench/artifact-bench/analyze-p6.py <A のフォルダ> <B> <C> <D> [出力の JSON]
- A：差し戻しなし ／ B：意見だけ ／ C：確かめだけ ／ D：両方
- 単位は (お題, 回)。4つの形がそろった単位だけを使う
"""
import json, math, re, sys, difflib, random, warnings
warnings.filterwarnings('ignore')
from collections import defaultdict
import numpy as np
from scipy import stats
import pandas as pd
import statsmodels.formula.api as smf

ARMS = ['A', 'B', 'C', 'D']
FACTORS = {'A': (0, 0), 'B': (1, 0), 'C': (0, 1), 'D': (1, 1)}  # (意見, 確かめ)
JUDGES = ['gemini-3.8-flash', 'gemini-3.7-flash']
DIMS = ['fulfillment', 'visual', 'usability', 'clarity', 'conciseness']
# gemini-3.5-flash-lite の料金（100万トークンあたり、考えた分は出力に含む）
import os
PRICE_IN, PRICE_OUT = float(os.environ.get('PRICE_IN', 0.30)), float(os.environ.get('PRICE_OUT', 2.50))  # 3.8 Flash は 0.75・3.75

# 守りの書き方（元の論文の「ぼかし語」に当たるもの）。1行に何回出ても数える
DEFENSIVE = [
    r'\btry\s*\{', r'\?\.', r'\?\?', r'\bif\s*\(\s*!\s*[\w.\[\]\'"]+\s*\)\s*(return|\{\s*return)',
    r'typeof\s+[\w.]+\s*[!=]==?\s*[\'"]undefined[\'"]', r'Array\.isArray\(', r'\|\|\s*(\[\]|\{\}|\'\'|""|0)\b',
    r'Number\.isFinite\(|isNaN\(',
]


def sse_events(text):
    for block in text.split('\n\n'):
        if not block.startswith('event: '):
            continue
        name = block.split('\n')[0][7:].strip()
        line = next((l for l in block.split('\n') if l.startswith('data: ')), None)
        if not line:
            continue
        try:
            yield name, json.loads(line[6:])
        except Exception:
            continue


def code_metrics(files):
    """files: {path: content} → 行数・守りの書き方の数（コードのファイルだけ。CSS は行数だけ）"""
    loc = 0
    defensive = 0
    for p, c in files.items():
        lines = [l for l in c.split('\n') if l.strip() and not l.strip().startswith('//')]
        loc += len(lines)
        if re.search(r'\.(t|j)sx?$', p):
            defensive += sum(len(re.findall(rx, c)) for rx in DEFENSIVE)
    return loc, defensive


def run_record(dir_, r):
    rec = {'id': r['id'], 'run': r['run'], 'ok': bool(r.get('ok')), 'produced': bool(r.get('produced'))}
    j = r.get('judge') or {}
    rec['judge'] = j.get('score')
    rec['judge_samples'] = j.get('samples')
    rec['pass'] = bool(r.get('ok')) and j.get('score') == 2
    for m in JUDGES:
        s = ((r.get('rubric') or {}).get(m) or {}).get('scores')
        for d in DIMS:
            rec[f'{m}:{d}'] = s.get(d) if s else None
    rec['seconds'] = r.get('finalSeconds')
    rec['repairs'] = r.get('repairs') or 0
    # 使った量（返事ごとの complete の usage を足す）
    calls = tin = tout = tthink = 0
    for g in (r.get('generations') or []):
        if not g:
            continue
        t = g.get('total') or {}
        calls += t.get('calls', 0); tin += t.get('inputTokens', 0); tout += t.get('outputTokens', 0); tthink += t.get('thinkingTokens', 0)
    rec.update(calls=calls, tokens_in=tin, tokens_out=tout, tokens_think=tthink, tokens=tin + tout + tthink,
               cost=(tin * PRICE_IN + (tout + tthink) * PRICE_OUT) / 1e6)
    # 返事をまるごと読み、Ren の差し戻しと、最初の版・最後の版を取り出す
    sse_path = f"{dir_}/sse/{r['id']}-{r['run']}.txt"
    try:
        text = open(sse_path, encoding='utf-8').read()
    except FileNotFoundError:
        text = ''
    ren_rounds = 0
    ren_loops = 0
    first = {}
    final = None
    gen_reviews = []
    for name, d in sse_events(text):
        if name == 'review':
            ren_rounds += 1
            gen_reviews.append(d)
        elif name == 'file-complete' and d.get('file') and d['file'] not in first:
            first[d['file']] = d.get('content') or ''
        elif name == 'complete':
            final = {f['path']: f.get('content') or '' for f in (d.get('files') or [])}
            # 返事1回の中で、見直しが n 回あれば差し戻しは n-1 回
            if gen_reviews:
                ren_loops += max(0, max(v.get('iteration', 1) for v in gen_reviews) - 1)
            gen_reviews = []
    rec['ren_rounds'] = ren_rounds
    rec['ren_loops'] = ren_loops
    rec['loops'] = ren_loops + rec['repairs']
    # Ren の1回目の指摘の数（意見の上司が何を言ったか）
    first_issues = 0
    for name, d in sse_events(text):
        if name == 'review' and d.get('iteration') == 1:
            first_issues = sum(len(fr.get('issues') or []) for fr in (d.get('fileReviews') or []))
            break
    rec['ren_first_issues'] = first_issues
    if first and final:
        l0, d0 = code_metrics(first)
        l1, d1 = code_metrics(final)
        a = '\n'.join(first[p] for p in sorted(first))
        b = '\n'.join(final[p] for p in sorted(final))
        sm = difflib.SequenceMatcher(None, a.split('\n'), b.split('\n'), autojunk=False)
        rec.update(loc_first=l0, loc_final=l1, def_first=d0, def_final=d1,
                   def_density_first=100 * d0 / max(l0, 1), def_density_final=100 * d1 / max(l1, 1),
                   retained=sm.ratio())
    return rec


def load(dir_, arm):
    data = json.load(open(f'{dir_}/results.json', encoding='utf-8'))
    out = []
    for r in data['results']:
        rec = run_record(dir_, r)
        rec['arm'] = arm
        rec['opinion'], rec['verifier'] = FACTORS[arm]
        out.append(rec)
    return out


def holm(ps):
    order = sorted(range(len(ps)), key=lambda i: ps[i])
    adj = [0.0] * len(ps)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(ps) - rank) * ps[i]))
        adj[i] = running
    return adj


def mcnemar(x, y):
    """対応のある合否：x だけ合格の数 b、y だけ合格の数 c。正確な二項検定"""
    b = sum(1 for p, q in zip(x, y) if p and not q)
    c = sum(1 for p, q in zip(x, y) if q and not p)
    n = b + c
    p = 1.0 if n == 0 else min(1.0, 2 * stats.binom.cdf(min(b, c), n, 0.5))
    return b, c, p


def paired(x, y):
    """y - x の対応のある比べ：平均の差・Cohen の dz・t 検定・Wilcoxon"""
    x = np.asarray(x, float); y = np.asarray(y, float)
    m = ~(np.isnan(x) | np.isnan(y))
    d = y[m] - x[m]
    if len(d) < 3 or np.allclose(d, 0):
        return dict(n=int(len(d)), mean_x=float(np.mean(x[m])) if len(d) else None, mean_y=float(np.mean(y[m])) if len(d) else None, diff=float(np.mean(d)) if len(d) else 0.0, dz=0.0, p_t=1.0, p_w=1.0)
    t = stats.ttest_rel(y[m], x[m])
    try:
        w = stats.wilcoxon(d, zero_method='wilcox')
        pw = float(w.pvalue)
    except ValueError:
        pw = 1.0
    sd = np.std(d, ddof=1)
    return dict(n=int(len(d)), mean_x=float(np.mean(x[m])), mean_y=float(np.mean(y[m])), diff=float(np.mean(d)),
                dz=float(np.mean(d) / sd) if sd > 0 else 0.0, p_t=float(t.pvalue), p_w=pw)


def cluster_bootstrap(units, contrast, n=4000, seed=7):
    """お題ごとにまとめて取り直す（同じお題の2回は似るため）。95% 区間"""
    rng = random.Random(seed)
    by_prompt = defaultdict(list)
    for u in units:
        by_prompt[u['id']].append(u)
    prompts = list(by_prompt)
    vals = []
    for _ in range(n):
        sample = [u for p in (rng.choice(prompts) for _ in prompts) for u in by_prompt[p]]
        v = [contrast(u) for u in sample]
        v = [x for x in v if x is not None and not math.isnan(x)]
        if v:
            vals.append(float(np.mean(v)))
    vals.sort()
    if not vals:
        return [float('nan'), float('nan')]
    return [vals[int(0.025 * len(vals))], vals[max(0, int(0.975 * len(vals)) - 1)]]


def krippendorff_interval(a, b):
    """2人の審査役の一致（間隔尺度の Krippendorff α）"""
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if len(pairs) < 3:
        return None
    vals = [v for p in pairs for v in p]
    n = len(vals)
    do = sum((x - y) ** 2 for x, y in pairs) * 2 / (2 * len(pairs))
    mean = np.mean(vals)
    de = sum((v - w) ** 2 for v in vals for w in vals) / (n * (n - 1))
    return float(1 - do / de) if de > 0 else None


def main():
    dirs = sys.argv[1:5]
    out_path = sys.argv[5] if len(sys.argv) > 5 else None
    recs = [r for arm, d in zip(ARMS, dirs) for r in load(d, arm)]
    df = pd.DataFrame(recs)
    # 審査の総合点（2人の審査役 × 5観点の平均）と、製品・コードの柱
    for m in JUDGES:
        df[f'{m}:product'] = df[[f'{m}:{d}' for d in ['fulfillment', 'visual', 'usability']]].mean(axis=1)
        df[f'{m}:code'] = df[[f'{m}:{d}' for d in ['clarity', 'conciseness']]].mean(axis=1)
        df[f'{m}:overall'] = df[[f'{m}:{d}' for d in DIMS]].mean(axis=1)
    for col in DIMS + ['product', 'code', 'overall']:
        df[f'panel:{col}'] = df[[f'{m}:{col}' for m in JUDGES]].mean(axis=1)
    df['judge_mean'] = df['judge_samples'].apply(lambda s: np.mean([x for x in s if x is not None]) if isinstance(s, list) and any(x is not None for x in s) else np.nan)

    # 4つの形がそろった単位
    key = ['id', 'run']
    complete = df.groupby(key)['arm'].nunique()
    keep = complete[complete == 4].index
    df = df.set_index(key).loc[keep].reset_index()
    wide = {arm: df[df.arm == arm].set_index(key).sort_index() for arm in ARMS}
    units = list(wide['A'].index)
    res = {'n_units': len(units), 'n_prompts': len(set(i for i, _ in units))}

    metrics = ['pass', 'ok', 'judge', 'judge_mean'] + [f'panel:{c}' for c in DIMS + ['product', 'code', 'overall']] + \
              ['ren_loops', 'repairs', 'loops', 'calls', 'tokens', 'cost', 'seconds', 'loc_final', 'def_density_final', 'retained']
    res['means'] = {arm: {m: (float(wide[arm][m].astype(float).mean()) if m in wide[arm] else None) for m in metrics} for arm in ARMS}

    # 主な比べ：元の論文と同じ（B 対 A）、確かめ（C 対 A）、確かめに意見を足す（D 対 C）、意見に確かめを足す（D 対 B）
    comparisons = [('A', 'B'), ('A', 'C'), ('C', 'D'), ('B', 'D')]
    primary = ['pass', 'panel:overall', 'panel:product', 'panel:code']
    res['pairs'] = {}
    pvals = []
    for x, y in comparisons:
        entry = {}
        bx, cx, p = mcnemar(wide[x]['pass'], wide[y]['pass'])
        entry['pass'] = dict(rate_x=float(wide[x]['pass'].mean()), rate_y=float(wide[y]['pass'].mean()), only_x=bx, only_y=cx, p=p)
        pvals.append(p)
        for m in primary[1:] + [f'panel:{d}' for d in DIMS] + ['judge_mean', 'cost', 'seconds', 'tokens', 'loc_final', 'def_density_final']:
            entry[m] = paired(wide[x][m].astype(float), wide[y][m].astype(float))
            if m in primary:
                pvals.append(entry[m]['p_t'])
        res['pairs'][f'{x}->{y}'] = entry
    adj = holm(pvals)
    i = 0
    for x, y in comparisons:
        e = res['pairs'][f'{x}->{y}']
        e['pass']['p_holm'] = adj[i]; i += 1
        for m in primary[1:]:
            e[m]['p_holm'] = adj[i]; i += 1

    # 2×2：主効果と交互作用（単位ごとの差の平均。お題ごとに取り直した 95% 区間）
    def cell(u, arm, m):
        v = wide[arm].loc[u, m]
        return float(v) if v is not None and not (isinstance(v, float) and math.isnan(v)) else float('nan')
    res['factorial'] = {}
    for m in ['pass', 'panel:overall', 'panel:product', 'panel:code', 'judge_mean', 'panel:clarity', 'panel:conciseness', 'loc_final', 'def_density_final', 'cost', 'seconds']:
        def opinion_eff(u, m=m): return (cell(u, 'B', m) + cell(u, 'D', m) - cell(u, 'A', m) - cell(u, 'C', m)) / 2
        def verifier_eff(u, m=m): return (cell(u, 'C', m) + cell(u, 'D', m) - cell(u, 'A', m) - cell(u, 'B', m)) / 2
        def inter(u, m=m): return (cell(u, 'D', m) - cell(u, 'C', m)) - (cell(u, 'B', m) - cell(u, 'A', m))
        entry = {}
        for name, f in [('opinion', opinion_eff), ('verifier', verifier_eff), ('interaction', inter)]:
            vals = [f(u) for u in units]
            vals = [v for v in vals if not math.isnan(v)]
            t = stats.ttest_1samp(vals, 0.0) if len(vals) > 2 and np.std(vals) > 0 else None
            entry[name] = dict(mean=float(np.mean(vals)) if vals else float('nan'), ci95=cluster_bootstrap([{'id': u[0], 'u': u} for u in units], lambda x, f=f: f(x['u'])), p=float(t.pvalue) if t else 1.0)
        res['factorial'][m] = entry

    # 混合モデル（お題をランダム効果）：総合点 ~ 意見 × 確かめ
    try:
        md = smf.mixedlm('Q("panel:overall") ~ opinion * verifier', df, groups=df['id']).fit(reml=True)
        res['mixedlm_overall'] = {k: dict(coef=float(md.params[k]), p=float(md.pvalues[k])) for k in md.params.index if k != 'Group Var'}
    except Exception as e:  # noqa: BLE001
        res['mixedlm_overall'] = {'error': str(e)}
    try:
        lg = smf.logit('passed ~ opinion * verifier', df.assign(passed=df['pass'].astype(int))).fit(disp=0, cov_type='cluster', cov_kwds={'groups': pd.factorize(df['id'])[0]})
        res['logit_pass'] = {k: dict(coef=float(lg.params[k]), p=float(lg.pvalues[k])) for k in lg.params.index}
    except Exception as e:  # noqa: BLE001
        res['logit_pass'] = {'error': str(e)}

    # 差し戻しの回数と出来（意見の上司がいる形の中。回数は上司が選ぶので相関）
    res['dose'] = {}
    for arm in ['B', 'D']:
        w = wide[arm]
        for m in ['panel:overall', 'panel:code', 'panel:product', 'judge_mean']:
            x = w['ren_loops'].astype(float); y = w[m].astype(float)
            ok = ~(x.isna() | y.isna())
            rho = stats.spearmanr(x[ok], y[ok]) if ok.sum() > 3 else None
            lr = stats.linregress(x[ok], y[ok]) if ok.sum() > 3 and x[ok].nunique() > 1 else None
            res['dose'][f'{arm}:{m}'] = dict(rho=float(rho.statistic) if rho else None, p=float(rho.pvalue) if rho else None,
                                             slope=float(lr.slope) if lr else None, slope_p=float(lr.pvalue) if lr else None,
                                             loops_dist={int(k): int(v) for k, v in w['ren_loops'].value_counts().items()})
    # 下書きは同じか：B の最初の版と A の仕上がり（A は直さないので最初の版＝仕上がり）のコードの量・守りの密度
    res['drafts'] = {
        'A_final_vs_B_first_loc': paired(wide['A']['loc_final'].astype(float), wide['B']['loc_first'].astype(float)),
        'A_final_vs_B_first_def': paired(wide['A']['def_density_final'].astype(float), wide['B']['def_density_first'].astype(float)),
        'B_first_vs_final_loc': paired(wide['B']['loc_first'].astype(float), wide['B']['loc_final'].astype(float)),
        'B_first_vs_final_def': paired(wide['B']['def_density_first'].astype(float), wide['B']['def_density_final'].astype(float)),
        'D_first_vs_final_def': paired(wide['D']['def_density_first'].astype(float), wide['D']['def_density_final'].astype(float)),
        'B_retained_mean': float(wide['B']['retained'].astype(float).mean()),
    }
    # 審査役どうしの一致
    res['agreement'] = {}
    for d in DIMS + ['overall']:
        a = df[f'{JUDGES[0]}:{d}'].tolist(); b = df[f'{JUDGES[1]}:{d}'].tolist()
        res['agreement'][d] = krippendorff_interval(a, b)
    # 審査役を1人ずつ外しても結論が同じか（B 対 A の総合点）
    res['leave_one_judge'] = {m: paired(wide['A'][f'{m}:overall'].astype(float), wide['B'][f'{m}:overall'].astype(float)) for m in JUDGES}

    print(json.dumps(res, ensure_ascii=False, indent=1, default=float))
    if out_path:
        json.dump(res, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=float)
        df.to_csv(out_path.replace('.json', '.csv'), index=False)


if __name__ == '__main__':
    main()
