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
    python3 scripts/audit-amazon-links.py             # 全ASIN＋商品画像を点検
    python3 scripts/audit-amazon-links.py --no-images # 画像検査を省く
    python3 scripts/audit-amazon-links.py --rakuten   # 楽天URLの到達性も点検（時間がかかる）

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
INDEX = os.path.join(REPO, "shampoo", "index.html")
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
    """shampoo/index.html の TYPES を Node で評価して商品リストを取り出す。

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
    img:p.img_url||null,desc:p.desc||"",note:p.note||"",types:[]});
  seen.get(p.name).types.push(tk);
}
process.stdout.write(JSON.stringify([...seen.values()]));
"""
    r = subprocess.run(["node", "-e", script, INDEX], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("✗ shampoo/index.html の読み取りに失敗しました:\n" + r.stderr)
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


# 商品カードの表示枠は 72x72px（.prod-img-wrap）。Retina 3倍でも 216px あれば足りる。
# 下限 144px = 2倍相当、上限 400px = 3倍に少し余裕を持たせた線。
DISPLAY_PX = 72
MIN_PX = 144
MAX_PX = 400
DUMMY_BYTES = 1000  # Amazon の欠番画像は 1x1 の 43 バイトで返る


def image_size(path):
    """JPEG/PNG のヘッダから (幅, 高さ) を読む。Pillow を入れずに済ませる。"""
    with open(path, "rb") as f:
        head = f.read(24)
        if len(head) < 24:
            return None
        if head[:8] == b"\x89PNG\r\n\x1a\n":
            return (int.from_bytes(head[16:20], "big"),
                    int.from_bytes(head[20:24], "big"))
        if head[:2] != b"\xff\xd8":
            return None
        f.seek(2)
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            marker = b[0]
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                continue
            ln = f.read(2)
            if len(ln) < 2:
                return None
            seg = int.from_bytes(ln, "big")
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                data = f.read(5)
                if len(data) < 5:
                    return None
                return (int.from_bytes(data[3:5], "big"),
                        int.from_bytes(data[1:3], "big"))
            f.seek(seg - 2, 1)


def audit_images(products):
    """商品カード画像が生きているか・無駄に大きくないかを見る。

    check-affiliate.sh も check-design.js もネットワークを見ないので、画像の
    失効（Amazon の P形式が 1x1 のダミーに化ける等）は誰も検出できなかった。
    2026-09-02 にエクラリティ・THE PUBLIC ORGANIC・Straine SOFT の3枚が
    本番で表示されないまま放置されていたのが見つかり、この検査を追加した。
    """
    problems = []
    targets = [p for p in products if p["img"]]
    print("\n商品画像 %d件を点検します（表示枠 %dpx / 下限 %dpx / 上限 %dpx）\n"
          % (len(targets), DISPLAY_PX, MIN_PX, MAX_PX))
    tmp = os.path.join(REPO, ".audit-img.tmp")
    total = 0
    for p in targets:
        # 楽天の tshop.r10s.jp は 0 バイトを返すことがある（2026-09-02 実地で確認）。
        # 単発取得だと生きている画像を「取得できない」と誤判定するので取り直す。
        size, dim = 0, None
        for attempt in range(3):
            r = subprocess.run(
                ["curl", "-s", "-o", tmp, "-w", "%{size_download}", "-L", "--max-time", "30",
                 "-H", "User-Agent: " + UA, p["img"]],
                capture_output=True, text=True)
            try:
                size = int(r.stdout.strip() or 0)
            except ValueError:
                size = 0
            dim = image_size(tmp) if size > 0 and os.path.exists(tmp) else None
            if size >= DUMMY_BYTES and dim:
                break
            if attempt < 2:
                time.sleep(2)
        total += size

        if size == 0:
            status, detail = "NG", "取得できない（0バイト）"
        elif size < DUMMY_BYTES or dim in (None, (1, 1)):
            status, detail = "NG", "ダミー画像（%dバイト %s）" % (size, dim)
        elif max(dim) < MIN_PX:
            status, detail = "NG", "小さすぎる %dx%d（Retinaでぼやける）" % dim
        elif max(dim) > MAX_PX:
            status, detail = "大", "%dx%d・%dKB（%dpx枠に対して過大）" % (dim[0], dim[1], size // 1024, DISPLAY_PX)
        else:
            status, detail = "ok", "%dx%d・%dKB" % (dim[0], dim[1], size // 1024)

        if status == "NG":
            problems.append(("image", p["name"], "画像NG", detail + " / " + p["img"][:60]))
        print("%s %-42s %s" % (status, p["name"][:42], detail))
        time.sleep(0.3)

    if os.path.exists(tmp):
        os.remove(tmp)
    print("\n画像の合計転送量: %d KB（平均 %d KB/枚）"
          % (total // 1024, total // 1024 // max(1, len(targets))))
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
    if "--no-images" not in sys.argv:
        problems += audit_images(products)
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
          "sh .githooks/check-affiliate.sh shampoo/index.html を通すこと。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
