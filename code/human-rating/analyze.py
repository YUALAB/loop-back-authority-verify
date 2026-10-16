"""論文 006：人の見比べ採点のまとめ（B＝意見の差し戻しあり が良いと言われた向きを ＋ にそろえる）
使い方: $CLAUDE_JOB_DIR/tmp/statsenv/bin/python bench/artifact-bench/human-rating/analyze.py
"""
import json, os, statistics as st
from scipy import stats
HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.join(HERE, '..', 'results')
key = {k['n']: k for k in json.load(open(os.path.join(HERE, 'key.json')))}
ans = json.load(open(os.path.join(HERE, 'ratings.json')))
res = {arm: {(r['id'], r['run']): r for r in json.load(open(f'{R}/202610152355-dev-p6-{arm}/results.json'))['results']} for arm in 'AB'}

def llm(arm, id_, run):
    rb = res[arm][(id_, run)].get('rubric', {})
    return st.mean(st.mean(v['scores'].values()) for v in rb.values())

rows = []
for n, a in sorted(ans.items()):
    k = key[n]
    human = a['v'] if k['R'] == 'B' else -a['v']
    d = llm('B', k['id'], k['run']) - llm('A', k['id'], k['run'])
    rows.append((n, k['id'], human, round(d, 2), a.get('memo', '')))
    print(n, k['id'].ljust(14), 'B寄り' if human > 0 else 'A寄り' if human < 0 else '同じ', human, 'LLM差', round(d, 2), a.get('memo', ''))

h = [r[2] for r in rows]; l = [r[3] for r in rows]
print(f'\n組 {len(h)}：B（意見あり）が良い {sum(x>0 for x in h)}・同じ {sum(x==0 for x in h)}・A（なし）が良い {sum(x<0 for x in h)}')
print('人の平均（−2〜+2、＋がB）', round(st.mean(h), 2))
nz = [x for x in h if x]
if nz: print('符号検定 p =', round(stats.binomtest(sum(x > 0 for x in nz), len(nz)).pvalue, 3))
if len(set(h)) > 1: print('Wilcoxon p =', round(stats.wilcoxon(h).pvalue, 3))
print('人と LLM 審査の順位相関 ρ =', round(stats.spearmanr(h, l).statistic, 2), 'p =', round(stats.spearmanr(h, l).pvalue, 3))
sign = lambda x, eps: 0 if abs(x) < eps else (1 if x > 0 else -1)
same = sum(sign(a, .5) == sign(b, .25) for a, b in zip(h, l))
print(f'向きの一致（人の±1以上・LLM差±0.25以上で向きあり）{same}/{len(h)}')
