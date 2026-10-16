# Data and code: Does Loop-Back Authority Pay Only When It Can Verify?

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.23423127.svg)](https://doi.org/10.5281/zenodo.23423127)

Data, analysis outputs and code for the paper

> Shinji Yumura. **Does Loop-Back Authority Pay Only When It Can Verify? A 2×2 Paired Experiment on Opinion- and Verifier-Triggered Revision in a Production Code-Generation Agent Team.** AQUA Research Technical Report 006, AQUA LLC, 2026.
> Japanese: <https://www.aquallc.jp/research/authority-needs-verification/> · English PDF: <https://www.aquallc.jp/wp-content/uploads/research/aqua-tr-006-authority-needs-verification-en.pdf>

The study tests the conjecture of Agachan, van Duijn and Zohrehvand ([arXiv:2609.14767](https://arxiv.org/abs/2609.14767)) that a manager agent's loop-back authority "earns its cost when it can verify something and becomes a liability when it can only opine", in the five-agent team that builds React apps in the Dev Mode of the assistant YUA.

## Design

Two revision triggers were switched on and off independently (2×2, paired by task and run; all four arms ran concurrently on separate servers):

| Arm | Opinion trigger (LLM reviewer sends files back, ≤ 2 rounds) | Verifier trigger (runtime errors in the preview are sent back, ≤ 2 rounds) |
|---|---|---|
| A | off | off |
| B | on | off |
| C | off | on |
| D | on | on |

* 24 tasks (`tasks/prompts.json`) × 2 runs × 4 arms = 192 generations per experiment.
* **Experiment 1** (`data/exp1-flash-lite/`): every agent `gemini-3.5-flash-lite` (the production model), 2026-10-15/16 JST.
* **Experiment 2** (`data/exp2-flash/`): every agent `gemini-3.8-flash`, 2026-10-16 JST.
* Judges (blind to arm): a 0/1/2 pass judge (`gemini-3.8-flash`, median of three) and two rubric judges (`gemini-3.8-flash`, `gemini-3.7-flash`) scoring fulfillment, visual, usability, clarity and conciseness on 1–5 after writing notes.
* How the opinion reviewer was calibrated: `code/reviewer-mandate.md`.

## Contents

```
tasks/prompts.json                 24 tasks (Japanese prompts, with tags)
data/<experiment>/<arm>/
  results.json                     one record per run (see fields below)
  summary.md                       automatic run summary
  <task>-<run>.files.json          final generated source files
  <task>-<run>.png                 screenshot of the final preview
  sse/<task>-<run>.txt             full server-sent event stream of the run
                                   (plan, inter-agent messages, code chunks,
                                   every review with its critiques, usage)
data/exp1-flash-lite/A-rerun/      one run (dashboard-1) that failed with a
                                   connection reset and was rerun; already
                                   merged into A/results.json (flag "redo")
data/human-rating/                 blinded human comparison (24 A–B pairs, exp. 1)
  pairs.json                       presentation order and prompts
  key.json                         which side was A / B in each pair
  ratings.json                     ratings (-2..+2, + = right side better)
                                   and one-line reasons (Japanese)
analysis/
  exp*-analysis.json               all statistics reported in the paper
  exp*-per-run.csv                 one row per run and arm (scores, cost, time,
                                   lines of code, defensive density, ...)
  exp*-critiques.json              reviewer critiques extracted from the streams
  exp*-critiques-labeled-*.json    the same, labelled into six categories
                                   (bug, missing, extra, defensive, ux, code)
code/                              scripts (see below)
```

### Main fields of `results.json`

| Field | Meaning |
|---|---|
| `id`, `run` | task id and run index (pairing key across arms) |
| `produced`, `noError`, `notBlank`, `survives`, `ok` | whether a preview appeared, had no runtime error, was not blank, survived clicking every button; `ok` = all of these |
| `seconds`, `finalSeconds` | time to first completion / to the end including repairs |
| `reviews` | reviewer verdicts per round (`iteration`, `status`, `score`) |
| `generations` | token usage per generation (input, output, thinking) |
| `repairs` | verifier-triggered repair rounds |
| `judge` | pass judge (`score` 0/1/2, `issues`, three samples) |
| `rubric` | rubric scores and notes per judge model |

Japanese text appears throughout (prompts, generated apps, critiques, judge notes, human reasons).

## Code

| File | Purpose |
|---|---|
| `code/run-dev.cjs` | drives the Dev Mode UI in headless Chrome, records the stream, files, screenshot and runtime checks |
| `code/judge.cjs` | pass judge (run with `JUDGE_MODEL=gemini-3.8-flash`) |
| `code/judge-rubric.cjs` | five-dimension rubric judges |
| `code/classify-critiques.cjs` | labels reviewer critiques into six categories |
| `code/analyze-p6.py` | all statistics (paired tests, 2×2 effects with task-clustered bootstrap, mixed models, Holm, Krippendorff's α, dose–response, draft inflation); costs use `PRICE_IN`/`PRICE_OUT` per million tokens (exp. 2: 0.75 / 3.75) |
| `code/human-rating/` | builds the blinded side-by-side rating page with the production preview renderer, serves it, and analyses the ratings |
| `code/reviewer-mandate.md` | the instruction added to the reviewer in the opinion arms |

The generation scripts require the YUA application, which is not public; they are released as an exact record of the procedure. The judging and analysis scripts run on the released data (the judges need a Gemini API key). Example:

```
python code/analyze-p6.py data/exp1-flash-lite/{A,B,C,D} out.json
```

(`analyze-p6.py` needs `scipy`, `statsmodels`, `pandas`.)

## Notes

* Email addresses and shop names inside generated apps are fictitious content produced by the model.
* The production system prompts and the YUA source code are not included.
* Human ratings: one rater (the author), blinded to arm, left/right randomized, interacting with both live apps.

## Citing the data

Shinji Yumura. *Data and code for: Does Loop-Back Authority Pay Only When It Can Verify?* (v1.0.0). Zenodo, 2026. <https://doi.org/10.5281/zenodo.23423127>

## License

Data (`tasks/`, `data/`, `analysis/`): CC BY 4.0 (`LICENSE-DATA`). Code (`code/`): MIT (`LICENSE`).

## 日本語の概要

AQUA Research 006「差し戻す権限は、確かめられるときだけ役に立つか」の実験データとプログラムです。YUA の開発モードの5人のチームで、「意見の差し戻し」と「確かめの差し戻し」を入れたり切ったりした4つの形（A〜D）を、24題×2回ずつ、2つのモデルで動かした全384回の記録・審査・分析と、著者による24組の見比べ採点を含みます。論文：<https://www.aquallc.jp/research/authority-needs-verification/>
