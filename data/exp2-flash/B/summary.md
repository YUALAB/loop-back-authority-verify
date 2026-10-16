# 開発モードの成績（p7-B）

- 日時: 202610161732
- 場所: http://localhost:3108
- 1つのお題につき 2 回

| 分け方 | 回数 | 動いた | 画面が出た | エラーなし | 真っ白でない | 押しても平気 |
|---|---|---|---|---|---|---|
| 全体 | 48 | 91.7% | 100% | 93.8% | 100% | 91.7% |
| グラフ | 10 | 100% | 100% | 100% | 100% | 100% |
| 3D | 4 | 100% | 100% | 100% | 100% | 100% |
| その他 | 34 | 88.2% | 100% | 91.2% | 100% | 88.2% |

## うまくいかなかったもの

- bmi#1: 画面のエラー表示: Runtime Error: (0 , _bmi.calculateBmi) is not a function
- kanban#2: 画面のエラー表示: Runtime Error: Cannot read properties of undefined (reading 'priority')
- drawing#2: 画面のエラー表示: Runtime Error: Cannot read properties of undefined (reading 'mode')
- physics#1: 押したあとのエラー表示: ResizeObserver loop completed with undelivered notifications. (line 0) / [Runtime Error] ResizeObserver loop completed with undelivered notifications. (line 0)

## 審査 v4（gemini-3.8-flash が写真とコードを見て採点）

| 分け方 | 回数 | 合格（2点） | 1点 | 0点 | 自動の判定も審査も合格 |
|---|---|---|---|---|---|
| 全体 | 48 | 81.3% | 8.3% | 10.4% | 79.2% |
| グラフ | 10 | 70% | 20% | 10% | 70% |
| 3D | 4 | 100% | 0% | 0% | 100% |
| その他 | 34 | 82.4% | 5.9% | 11.8% | 79.4% |
