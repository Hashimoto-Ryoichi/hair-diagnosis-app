#!/bin/sh
# sitemap.xml の <lastmod> を今日の日付に揃える（pre-commit から自動実行）。
#
# なぜ自動化するか:
#   Amazonアソシエイトの審査基準に「コンテンツは60日以内に更新されていること」があり、
#   2026-07-26 に lastmod が 66日前（2026-05-21）のまま放置されていたことが発覚した。
#   実態は毎週更新しているのに、サイトマップ上は「期限切れ」を自己申告している状態だった。
#   docs/amazon-reapplication-checklist.md に「更新したら lastmod も更新」と書いたが、
#   2026-07-30 に人間（AI含む）が再び忘れたため、機械で止めることにした。
#
# 発火条件: index.html がステージされているコミットのみ（pre-commit 側で判定）。
#   ドキュメントだけの変更で日付を動かすと、更新実態と申告がまた食い違うため。

set -e
root=$(git rev-parse --show-toplevel)
sitemap="$root/sitemap.xml"

if [ ! -f "$sitemap" ]; then
  echo "… sitemap.xml が見つからないため lastmod の同期をスキップしました" >&2
  exit 0
fi

today=$(date +%Y-%m-%d)
cur=$(sed -n 's:.*<lastmod>\([^<]*\)</lastmod>.*:\1:p' "$sitemap" | head -1)

if [ -z "$cur" ]; then
  echo "✗ sitemap.xml に <lastmod> が見つかりません。手で確認してください。" >&2
  exit 1
fi

if [ "$cur" = "$today" ]; then
  exit 0
fi

# macOS の sed は -i の扱いが GNU と違うため、一時ファイル経由で置換する
sed "s|<lastmod>[^<]*</lastmod>|<lastmod>$today</lastmod>|g" "$sitemap" > "$sitemap.new"
mv "$sitemap.new" "$sitemap"
git add "$sitemap"
echo "✓ sitemap.xml の lastmod を $cur → $today に更新し、このコミットに含めました"
exit 0
