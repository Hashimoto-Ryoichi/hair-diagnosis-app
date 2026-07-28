#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hair Identity — Amazon/楽天リンクの生存監査（ネットワークを使う点検）

check-affiliate.sh は「書式が正しいか」しか見ない（ネットワークを叩かないため）。
このスクリプトはその死角を埋める：ASINが実在し、説明どおりの商品で、いま買える状態かを実際に確認する。

経緯:
  2026-06-11 Amazon審査却下（未登録IDが本番に混入）
  2026-07-25 Amazon審査却下（JS生成リンクがクローラーに見えない）
  → 書式チェックはフックで自動化済み。残る穴が「リンク先が死んでいる／別商品にすり替わっている」。
    ASINはAmazon側の都合で別商品に付け替えられることがあり、コードを触っていなくても壊れる。

使い方:
    python3 scripts/audit-amazon-links.py            # 全ASINを点検
    python3 scripts/audit-amazon-links.py --rakuten  # 楽天URLの到達性も点検（時間がかかる）

終了コード: 問題が1件でもあれば 1。
月1回程度、また商品追加・ASIN差し替えのタイミングで回すこと。
"""

import html
import json
import os
import re
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX = os.path.join(REPO, "index.html")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")


def fetch(url, tries=3):
    """URLを取得して本文を返す。取れなければ空文字。"""
    for attempt in range(tries):
        try:
            r = subprocess.run(
                ["curl", "-s", "-L", "--max-time", "40",
                 "-H", "User-Agent: " + UA,
                 "-H", "Accept-Language: ja-JP,ja;q=0.9", url],
                capture_output=True, text=True, timeout=50)
            if r.stdout:
                return r.stdout
        except subprocess.TimeoutExpired:
            pass
        time.sleep(3)
    return ""


def load_products():
    """index.html の TYPES を Node で評価して商品リストを取り出す。

    正規表現で切り出すと入れ子やエスケープで壊れるため、実際に評価する
    （check-design.js と同じやり方）。
    """
    script = r"""
const fs=require("fs");
const src=fs.readFileSync(process.argv[1],"utf8");
const block=src.slice(src.indexOf("const MATCH_TAGS="),src.indexOf("function diagnose("));
const R1=(src.match(/const R1="([^"]*)"/)||[])[1]||"";
const R2=(src.match(/const R2="([^"]*)"/)||[])[1]||"";
const M=new Function("R1","R2","rak1",block+"\nreturn {TYPES};")(R1,R2,id=>R1+id+"/"+R2);
const seen=new Map();
for(const tk in M.TYPES) for(const p of M.TYPES[tk].products){
  if(!seen.has(p.name)) seen.set(p.name,{name:p.name,amz:p.amz||null,rak:p.rakUrl||null,
    desc:p.desc||"",note:p.note||"",types:[]});
  seen.get(p.name).types.push(tk);
}
process.stdout.write(JSON.stringify([...seen.values()]));
"""
    r = subprocess.run(["node", "-e", script, INDEX], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("✗ index.html の読み取りに失敗しました:\n" + r.stderr)
    return json.loads(r.stdout)


def audit_amazon(products):
    problems = []
    targets = [p for p in products if p["amz"]]
    print("Amazon ASIN %d件を点検します（1件あたり約2秒）\n" % len(targets))

    for p in targets:
        body = fetch("https://www.amazon.co.jp/dp/%s" % p["amz"])
        if 'id="productTitle"' not in body:
            problems.append((p["amz"], p["name"], "ページ取得不可", "?"))
            print("NG %s ページ取得不可 | %s" % (p["amz"], p["name"]))
            time.sleep(1.0)
            continue

        m = re.search(r'id="productTitle"[^>]*>([\s\S]{0,400}?)</span>', body)
        title = html.unescape(m.group(1)).strip() if m else "(取得不可)"
        price = re.findall(r'a-price-whole">([\d,]+)', body)
        # 在庫切れは outOfStock ブロックの有無で見る。
        # 「現在お取り扱いできません」という文字列はJSの翻訳テーブルにも入っていて
        # 全ページで一致してしまうため、判定に使わないこと（2026-07-29に誤検知で確認済み）。
        oos = ('id="outOfStock"' in body) or ("現在在庫切れです" in body)

        if oos:
            status = "在庫切れ"
        elif not price:
            status = "価格表示なし"
        else:
            status = "OK"

        if status != "OK":
            problems.append((p["amz"], p["name"], status, title))
        print("%s %s %-8s ¥%-7s | %s\n     → %s" % (
            "ok" if status == "OK" else "NG", p["amz"], status,
            price[0] if price else "-", p["name"][:34], title[:58]))
        time.sleep(1.0)

    return problems


def audit_rakuten(products):
    problems = []
    targets = [p for p in products if p["rak"]]
    print("\n楽天リンク %d件の到達性を点検します\n" % len(targets))
    for p in targets:
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "30",
             "-H", "User-Agent: " + UA, p["rak"]],
            capture_output=True, text=True)
        code = r.stdout.strip()
        ok = code.startswith("2")
        if not ok:
            problems.append(("rakuten", p["name"], "HTTP " + code, p["rak"][:70]))
        print("%s HTTP %s | %s" % ("ok" if ok else "NG", code, p["name"][:44]))
        time.sleep(0.8)
    return problems


def main():
    products = load_products()
    print("ユニーク商品 %d点（うちASINあり %d点 / 楽天専売 %d点）\n" % (
        len(products),
        sum(1 for p in products if p["amz"]),
        sum(1 for p in products if not p["amz"])))

    problems = audit_amazon(products)
    if "--rakuten" in sys.argv:
        problems += audit_rakuten(products)

    print("\n" + "=" * 60)
    if not problems:
        print("✓ 全リンク正常（実ページのタイトル・価格・在庫を確認）")
        return 0

    print("✗ 要対応 %d件" % len(problems))
    for asin, name, status, title in problems:
        print("  [%s] %s — %s" % (status, name, asin))
        print("        リンク先: %s" % title)
    print("\n在庫切れは一時的なこともあります。数日おいて戻らなければ、"
          "同じ商品の別ASIN（本体/詰め替え/セット）に差し替えてください。")
    print("差し替えたら静的商品一覧の <li> と <summary> の件数も直し、"
          "sh .githooks/check-affiliate.sh index.html を通すこと。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
