# アフィリエイトURL 2部署（生成部 / 構造チェック部）

Hair Identity（hair-diagnosis-app）のアフィリエイト収益を「URLの作り間違い」で取りこぼさないための、
2つの専門部署の仕様と手順書。

## なぜ作ったか（過去の事故）

- **2026-06-11（Amazon）**: 全Amazonリンクが未登録の旧ID `hassihair06-22` のまま本番に載り、
  「トラフィックのソースを特定できない」としてアソシエイト審査却下＋アカウント閉鎖＋収益喪失。
- **楽天の潜在リスク**: 楽天は素URL（`item.rakuten.co.jp/...`）をそのまま貼ると報酬が一切付かない。
  Amazon旧ID事故の楽天版にあたり、手貼りのぶん一番事故りやすいのにノーガードだった。

→ 「正しく作る」担当（①）と「同じ構造かを機械的に確かめる」担当（②）を分け、
   デプロイ前ゲートで型崩れを必ず止める。

---

## ① アフィリエイトURL生成部 — 正しいURLの作り方

各商品データ（index.html内の商品オブジェクト）が持つフィールドと、正しい入れ方。

### Amazon（`amz`）
- **入れるのはASINだけ**。例: `amz:"B00BTDV3FS"`
- ASINは **英大文字＋数字の10桁**（多くは `B0...` で始まる）。Amazon商品ページURLの `/dp/XXXXXXXXXX/` の部分。
- 本番URLは `const ASSOC_ID="hairidentity-22"` から **自動生成**される:
  `https://www.amazon.co.jp/dp/{ASIN}?tag=hairidentity-22`（[index.html](../index.html) の描画部）
- **やってはいけない**:
  - `tag=` を手書き・ハードコードする（IDは ASSOC_ID 経由のみ）
  - 旧ID `hassihair06-22` を使う（永久に禁止）
  - 商品ページのフルURLや短縮URLを `amz` に入れる（ASINだけ）
- Amazonに在庫が無い商品は `amz:null`（楽天のみで出す）。

### 楽天（`rakUrl`）
- **楽天アフィリエイト管理画面で発行した hybrid_url 全文を、そのまま `rakUrl` に貼る**。
- 正しい構造:
  `https://hb.afl.rakuten.co.jp/ichiba/{4セグメントのID}/?pc={URLエンコード済み商品URL}&link_type=hybrid_url&ut={base64}`
  - `link_type` は `hybrid_url` または `picttext`（バナー種別。どちらも可）
- **発行手順**:
  1. 候補商品名・楽天検索キーワード・JANコード（あれば）・想定店舗を橋元さんに提示
  2. 橋元さんが `affiliate.rakuten.co.jp` から hybrid_url を発行
  3. 受け取った全文を `rakUrl` に貼る
- **やってはいけない（＝報酬ゼロの原因）**:
  - 素の `item.rakuten.co.jp/...` や `product.rakuten.co.jp/...` を貼る（必ず `hb.afl.rakuten.co.jp/ichiba/` で始める）
  - 仮置きで先に進める（URLが手元に無ければ作業を止めて発行依頼）

> 出力（コミット/デプロイ）の前に、必ず②へ回す。

---

## ② URL構造チェック部 — 「今あるURLと同じ構造か」を機械判定

実体は **`.githooks/check-affiliate.sh`**（単一の正本）。pre-commitフックと
デプロイスキル（hair-identity-deploy）Step 0 の両方から呼ばれ、1つでも崩れていれば
**コミット／デプロイを止める**。

### 実行
```sh
sh .githooks/check-affiliate.sh            # index.html を検査
sh .githooks/check-affiliate.sh path.html  # 任意ファイルを検査
```

### 検査項目（全8項目）
| # | 対象 | 内容 |
|---|---|---|
| 1 | Amazon | `ASSOC_ID` が正式ID `hairidentity-22` でちょうど1回定義 |
| 2 | Amazon | 旧ID `hassihair06-22` がどこにも混入していない |
| 3 | Amazon | 規約必須の開示文言「適格販売により収入を得ています」が残っている |
| 4 | Amazon | 全 `amazon.co.jp/dp/` リンクが正式タグを通っている（タグ無し・別タグ禁止） |
| 5 | Amazon | 正式ID以外の `tag=` が直書きされていない |
| 6 | Amazon | 全 `amz` がASIN形式（英大文字＋数字の10桁） |
| 7 | 楽天 | 全 `rakUrl` が `hb.afl.rakuten.co.jp/ichiba/` を通っている（素URL禁止） |
| 8 | 楽天 | 全 `rakUrl` に `link_type=hybrid_url`／`picttext` がある（壊れ・改変検出） |

### 落ちたときの対応
- どの項目で落ちたかメッセージに出る。**①生成部の手順**に従ってURLを直し、再実行。
- フックの削除・`git commit --no-verify` での回避は **禁止**（事故の再発に直結）。
- 再クローン後は `git config core.hooksPath .githooks` の1行でフックが復活する。
