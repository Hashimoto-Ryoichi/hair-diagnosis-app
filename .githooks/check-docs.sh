#!/bin/sh
# Hair Identity — 参照ドキュメントの腐り検査（Amazon審査却下の再発防止）
#
# 経緯（2026-07-29）:
#   shampoo-appスキルの references/latest_index.html が2026-07-16版のまま放置され、
#   廃止済みアソシエイトID hairidentity-22 を含んでいた。これを作業ベースにすれば
#   2度の審査却下の直接原因（未登録IDの混入）をそのまま再発させる状態だった。
#
# 対策の考え方: 「気をつける」では防げない。腐る情報をドキュメントから消し、
#   残っていないことを機械が毎回確かめる。
#
# 検査:
#   1. スキル配下に廃止IDのベタ書きが無い（履歴・教訓としての言及は除外）
#   2. スキル配下に index.html のコピーが無い（コピーは必ず腐る）
#
# pre-commit から呼ばれる。スキルが見つからない環境（CI等）では黙って通す。

EXPECT_FILE="$(dirname "$0")/check-affiliate.sh"
OLDS=$(sed -n 's/^OLDS="\(.*\)"$/\1/p' "$EXPECT_FILE")
err=0

# スキルはプラグイン配下にあり、更新でパスが変わりうるのでglobで探す
# パスに空白（Application Support）が含まれるため、$(...)を素で回すと単語分割で壊れる。
# 必ずNUL区切りで受け取ること（2026-07-29、この書き方を誤って検査が素通りした）。
BASE="$HOME/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin"
[ -d "$BASE" ] || exit 0
tmplist=$(mktemp)
find "$BASE" -maxdepth 5 -type d -name "shampoo-app" > "$tmplist" 2>/dev/null
[ -s "$tmplist" ] || { rm -f "$tmplist"; exit 0; }

while IFS= read -r dir; do
  # 1) 廃止IDのベタ書き（「廃止」「却下」「旧」を含む行＝教訓として書いている行は除く）
  for old in $OLDS; do
    hits=$(grep -rn "$old" "$dir" 2>/dev/null | grep -v "廃止\|却下\|旧ID\|OLDS\|再発")
    if [ -n "$hits" ]; then
      echo "✗ ドキュメント検査: スキルに廃止ID($old)がベタ書きされています" >&2
      echo "$hits" >&2
      echo "  → IDは書かず「check-affiliate.sh の EXPECT= 行が正本」と書くこと" >&2
      err=1
    fi
  done

  # 2) index.html のコピー
  copies=$(find "$dir" -name "*.html" 2>/dev/null)
  if [ -n "$copies" ]; then
    echo "✗ ドキュメント検査: スキル内に index.html のコピーがあります（必ず腐ります）" >&2
    echo "$copies" >&2
    echo "  → 削除し、本番 ~/hair-diagnosis-app/index.html を読ませること" >&2
    err=1
  fi
  # パイプ内サブシェルだとerrが親に返らないため、失敗をファイルに残す
  [ "$err" = "1" ] && touch "$tmplist.ng"
done < "$tmplist"

if [ -f "$tmplist.ng" ]; then err=1; fi
rm -f "$tmplist" "$tmplist.ng"

[ "$err" = "0" ] && echo "✓ ドキュメント検査通過（スキルに廃止ID・コピーなし）"
exit "$err"
