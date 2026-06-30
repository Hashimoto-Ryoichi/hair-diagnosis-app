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
OLD="hassihair06-22"
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
if grep -q "$OLD" "$FILE"; then fail "旧ID($OLD)が混入しています"; fi

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

if [ "$err" = "0" ]; then echo "✓ アフィリエイトチェック通過（Amazon＋楽天 / $FILE）"; fi
exit "$err"
