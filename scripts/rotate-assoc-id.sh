#!/bin/sh
# アソシエイトID一括更新（Amazon再申請で新IDが発行されたときに使う）
# 使い方: sh scripts/rotate-assoc-id.sh 新ID
# やること:
#   1. index.html 内の旧ID（ASSOC_ID定義＋静的リンクの tag=）を全て新IDへ置換
#   2. .githooks/check-affiliate.sh の EXPECT を新IDへ差し替え、旧IDを OLDS（混入禁止リスト）へ追記
#   3. アフィリエイトチェックを実行して整合を確認
# 注意: 新IDは必ずアソシエイト管理画面の現物からコピーすること（記憶・推測での入力禁止）
set -e
cd "$(dirname "$0")/.."
NEW="$1"
HOOK=".githooks/check-affiliate.sh"
CUR=$(sed -n 's/^EXPECT="\(.*\)"$/\1/p' "$HOOK")
[ -n "$NEW" ] || { echo "使い方: sh scripts/rotate-assoc-id.sh 新ID（例: hairidentity0a-22）" >&2; exit 1; }
echo "$NEW" | grep -qE '^[a-z0-9]+-22$' || { echo "✗ IDの形式が不正です（英小文字数字+『-22』。例: hairidentity0a-22）" >&2; exit 1; }
[ "$NEW" != "$CUR" ] || { echo "✗ 現在のID($CUR)と同じです" >&2; exit 1; }
echo "現在ID: $CUR → 新ID: $NEW"
sed -i '' "s/$CUR/$NEW/g" index.html
sed -i '' "s/^EXPECT=\"$CUR\"/EXPECT=\"$NEW\"/" "$HOOK"
sed -i '' "s/^OLDS=\"/OLDS=\"$CUR /" "$HOOK"
sh "$HOOK" index.html
echo "✓ ID更新完了。この後: コミット → デプロイ → 本番ページのソース表示で tag=$NEW を目視確認 → それから再申請"
