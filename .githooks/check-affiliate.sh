#!/bin/sh
# Hair Identity — アフィリエイト事故防止チェック（Amazon＋楽天 / 単一の正本）
# ＝「URL構造チェック部」の実体。正しく作られたアフィリエイトURLだけを本番に通す品質ゲート。
# 経緯: 旧ID hassihair06-22 がアソシエイトアカウント未登録のまま本番に載り、
#       「トラフィックのソースを特定できない」としてAmazon審査却下＋収益喪失（2026-06-11）。
#       楽天は素URL(item.rakuten.co.jp)を貼ると報酬が付かない＝同種の収益喪失リスク。
# 正式ID(Amazon): hairidentity-22 ／ 楽天: hb.afl.rakuten.co.jp/ichiba/... のhybrid_urlのみ許可
# このスクリプトは pre-commit フックと deploy スキル Step 0 の両方から呼ばれる。
# 使い方: check-affiliate.sh [チェック対象ファイル]   （省略時は index.html）

FILE="${1:-index.html}"
EXPECT="hairidentity-22"
# 過去に使って廃止したID（半角スペース区切りで追記していく。ID変更時はrotate-assoc-id.shを使う）
OLDS="hassihair06-22"
err=0
fail() { echo "✗ Amazonアフィリチェック: $1" >&2; err=1; }

if [ ! -f "$FILE" ]; then
  echo "✗ Amazonアフィリチェック: $FILE が見つかりません" >&2
  exit 1
fi

# 1) ASSOC_ID が正式IDでちょうど1回定義されている
n=$(grep -c "const ASSOC_ID=\"$EXPECT\"" "$FILE")
[ "$n" = "1" ] || fail "ASSOC_ID が正式ID($EXPECT)で1回定義されていません（検出: $n 回）"

# 2) 旧IDがどこにも混入していない（.bak復元・コピペ事故対策）
for old in $OLDS; do
  if grep -q "$old" "$FILE"; then fail "旧ID($old)が混入しています"; fi
done

# 3) Amazon規約必須の開示文言が残っている
grep -q '適格販売により収入を得ています' "$FILE" || fail "Amazon規約の開示文言が見つかりません"

# 4) すべての amazon.co.jp/dp/ リンクが正式タグを通っている（タグ無し・別タグを禁止）
bad=$(grep -nE 'amazon\.co\.jp/dp/' "$FILE" | grep -vE 'tag=(\$\{ASSOC_ID\}|'"$EXPECT"')')
if [ -n "$bad" ]; then
  fail "正式タグを通っていないAmazonリンクがあります:"
  echo "$bad" >&2
fi

# 5) 正式ID以外の tag= が直書きされていない
badtag=$(grep -oE 'tag=[A-Za-z0-9_-]+' "$FILE" | grep -vxE "tag=$EXPECT")
if [ -n "$badtag" ]; then
  fail "正式ID以外のtagが直書きされています: $(echo "$badtag" | tr '\n' ' ')"
fi

# 6) Amazon: amz の値が ASIN形式（英大文字+数字の10桁）か
#    （素URLや桁欠け・余分な文字を貼ると dp リンクが壊れ、報酬が付かない）
badasin=$(grep -oE 'amz:"[^"]*"' "$FILE" | grep -vE 'amz:"[A-Z0-9]{10}"')
if [ -n "$badasin" ]; then
  fail "ASIN形式(英大文字+数字の10桁)でないamzがあります:"
  echo "$badasin" >&2
fi

# 7) 楽天: すべての rakUrl がアフィリエイトラッパーを通っている
#    （素の item.rakuten.co.jp 等を貼ると報酬が付かない＝Amazon旧ID事故の楽天版）
rakraw=$(grep -oE 'rakUrl:"[^"]*"' "$FILE" | grep -vE 'rakUrl:"https://hb\.afl\.rakuten\.co\.jp/ichiba/')
if [ -n "$rakraw" ]; then
  fail "楽天アフィリエイトを通っていない素URLのrakUrlがあります（hb.afl.rakuten.co.jp/ichiba/ で始める）:"
  echo "$rakraw" >&2
fi

# 8) 楽天: すべての rakUrl に link_type=(hybrid_url|picttext) がある（壊れ・改変の検出）
rakbad=$(grep -oE 'rakUrl:"[^"]*"' "$FILE" | grep -E 'rakUrl:"https://hb\.afl\.rakuten\.co\.jp/ichiba/' | grep -vE 'link_type=(hybrid_url|picttext)')
if [ -n "$rakbad" ]; then
  fail "link_type=(hybrid_url/picttext) が無い壊れた楽天URLがあります:"
  echo "$rakbad" >&2
fi

# 9) 楽天: rak1() 経由のリンク（直書きrakUrlを見るチェック7・8では検査されない死角）
#    rak1 は R1+商品ハッシュ+R2 でURLを組み立てるため、R1/R2の構造と引数の形式を検証する
if grep -q 'rakUrl:rak1(' "$FILE"; then
  grep -q 'const R1="https://hb\.afl\.rakuten\.co\.jp/ichiba/' "$FILE" || fail "rak1用のR1がアフィリエイトラッパー(hb.afl.rakuten.co.jp/ichiba/)で始まっていません"
  grep -q 'const R2="[^"]*link_type=hybrid_url' "$FILE" || fail "rak1用のR2に link_type=hybrid_url がありません"
  badrak1=$(grep -oE 'rakUrl:rak1\([^)]*\)' "$FILE" | grep -vE 'rakUrl:rak1\("[0-9a-f]{32}"\)')
  if [ -n "$badrak1" ]; then
    fail "rak1()の引数が商品ハッシュ(半角英数字32桁)の形式ではありません:"
    echo "$badrak1" >&2
  fi
fi

# 10) Amazon審査対策: 静的商品一覧セクションが存在し、商品データの全ASINと1:1で一致している
#     経緯: 2026-07-25 Amazon審査却下（2度目）。リンクが全てJS生成のため審査クローラーが
#     「トラッキングID付きリンクが1本も無い」と判定＝トラフィックソース特定不可となった。
#     審査はJSを実行せず生HTMLをクロールする（運営規約12条(b)にクロール調査の明記あり）。
if ! grep -q 'id="amazon-product-list"' "$FILE"; then
  fail "静的商品一覧セクション(id=\"amazon-product-list\")がありません（Amazon審査に必須）"
else
  data_asins=$(grep -oE 'amz:"[A-Z0-9]{10}"' "$FILE" | grep -oE '[A-Z0-9]{10}' | sort -u)
  static_asins=$(grep -oE 'href="https://www\.amazon\.co\.jp/dp/[A-Z0-9]{10}\?tag='"$EXPECT"'"' "$FILE" | grep -oE '[A-Z0-9]{10}' | sort -u)
  missing=$(printf '%s\n' "$data_asins" | while read -r a; do printf '%s\n' "$static_asins" | grep -qx "$a" || echo "$a"; done)
  stale=$(printf '%s\n' "$static_asins" | while read -r a; do printf '%s\n' "$data_asins" | grep -qx "$a" || echo "$a"; done)
  if [ -n "$missing" ]; then
    fail "静的商品一覧に載っていないASINがあります（商品追加時は静的一覧にも追記）:"
    echo "$missing" >&2
  fi
  if [ -n "$stale" ]; then
    fail "商品データに存在しないASINが静的一覧に残っています（商品削除時は静的一覧からも削除）:"
    echo "$stale" >&2
  fi
fi

# 11) Amazon規約5条: 開示文言が静的HTML（静的フッター内）にも存在する（JS描画のみでは審査側に見えない）
awk '/id="amazon-product-list"/,/<\/footer>/' "$FILE" | grep -q '適格販売により収入を得ています' \
  || fail "静的フッター内にAmazon開示文言（適格販売により収入を得ています）がありません"

if [ "$err" = "0" ]; then echo "✓ アフィリエイトチェック通過（Amazon＋楽天 / $FILE）"; fi
exit "$err"
