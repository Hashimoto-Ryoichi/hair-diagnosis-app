#!/bin/sh
# Hair Identity — Amazonアフィリエイト事故防止チェック（単一の正本）
# 経緯: 旧ID hassihair06-22 がアソシエイトアカウント未登録のまま本番に載り、
#       「トラフィックのソースを特定できない」としてAmazon審査却下＋収益喪失（2026-06-11）。
# 正式ID: hairidentity-22
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

if [ "$err" = "0" ]; then echo "✓ Amazonアフィリエイトチェック通過（$FILE）"; fi
exit "$err"
