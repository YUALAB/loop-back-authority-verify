# Reviewer calibration used in the opinion arms (B, D)

In the opinion arms, the following instruction was appended to the production reviewer's system prompt **on the first review round only** (the production reviewer prompt itself is not released):

> 【この見直しの決まり（上司として）】これは1回目の見直しです。作り手に直させる改善点を、ファイルごとに具体的に挙げてください（使いやすさ・見た目・分かりやすさ・コードの書き方など、より良くできる点。最大3つ）。改善点を挙げたファイルの status は fail にしてください。

English translation: *"[Rule for this review (as the manager)] This is the first review. For each file, list concrete improvements the worker should make (points that could be better in usability, looks, clarity, or code style; at most three). Set the status of every file for which you listed an improvement to fail."*

After parsing, any file with at least one listed issue was forced to `fail` with a score of at most 60, so that every listed file was sent back. In the no-opinion arms (A, C) the reviewer was not called and every file passed. Switches: `DEV_REVIEW_MODE=opinion|none`, `DEV_REVIEW_THRESHOLD`; the verifier trigger (automatic repair after a runtime error in the preview) was disabled with `?autorepair=0` / `AUTOREPAIR=0`.
