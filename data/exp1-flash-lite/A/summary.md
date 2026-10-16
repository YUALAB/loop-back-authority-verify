# 開発モードの成績（p6-A）

- 日時: 202610152355
- 場所: http://localhost:3107
- 1つのお題につき 2 回

| 分け方 | 回数 | 動いた | 画面が出た | エラーなし | 真っ白でない | 押しても平気 |
|---|---|---|---|---|---|---|
| 全体 | 48 | 95.8% | 97.9% | 97.9% | 100% | 97.9% |
| グラフ | 10 | 90% | 90% | 100% | 100% | 100% |
| 3D | 4 | 100% | 100% | 100% | 100% | 100% |
| その他 | 34 | 97.1% | 100% | 97.1% | 100% | 97.1% |

## うまくいかなかったもの

- converter#2: 画面のエラー表示: Runtime Error: Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: object. You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.

Check the render method
- dashboard#1: 画面が出なかった 

## 審査 v4（gemini-3.8-flash が写真とコードを見て採点）

| 分け方 | 回数 | 合格（2点） | 1点 | 0点 | 自動の判定も審査も合格 |
|---|---|---|---|---|---|
| 全体 | 48 | 77.1% | 20.8% | 2.1% | 77.1% |
| グラフ | 10 | 80% | 20% | 0% | 80% |
| 3D | 4 | 75% | 25% | 0% | 75% |
| その他 | 34 | 76.5% | 20.6% | 2.9% | 76.5% |
