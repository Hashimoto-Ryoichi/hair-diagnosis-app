#!/usr/bin/env node
// Hair Identity — 検索向けの静的ページを書き出す（2026-11-28 新設）
//
// なぜあるか:
//   診断アプリ（shampoo/index.html）はJavaScriptで画面を描くので、元のHTMLには読める文字がほとんど無かった。
//   Googleで「シャンプー診断」が35〜50位だった一番の原因。そこで、
//     ① /shampoo/ の最初の画面の下に「シャンプー診断について」（わかること・11タイプ・しくみ・よくある質問・作った人）
//     ② 11タイプごとのページ /shampoo/type/<slug>/
//     ③ sitemap.xml の11タイプ分の行
//   を、アプリ本体の TYPES（タイプ名・説明・ケアのポイント・商品）から機械で書き出す。
//   手で写すと、アプリを直したときに必ず食い違うため（Codexと一致した方針）。
//
// 使い方:
//   node scripts/build-seo-pages.js          # 書き出す（文章を直したら、このファイルを直してから実行）
//   node scripts/build-seo-pages.js --check  # コミットされる中身が最新か調べるだけ（pre-commit から自動実行）
//
// 文章のルール:
//   - 画面に見える文字として置く（検索向けに文字を隠すのはGoogleの規約違反）
//   - 「よくある質問」は画面の文と構造化データ（FAQPage）を同じ配列から作る＝食い違わない
//   - タイプページには購入リンクを置かない（並び順＝回答主導。順位は11問の答えで決まる）
//   - 他の商品・美容師を下げない。「絶対」「危険」「毒」などは使わない

"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const APP = "shampoo/index.html";
const SITEMAP = "sitemap.xml";
const SITE = "https://hashimoto-ryoichi.com";
const RESERVE_URL = "https://lin.ee/tazRvbX";
const CHECK = process.argv.includes("--check");

// ---- 読み書き（--check のときはコミットされる中身＝git の index を読む） ----
function readFile(rel) {
  if (CHECK) {
    try { return execSync(`git show :${rel}`, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { return null; }
  }
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

// ---- アプリ本体から TYPES を取り出す（check-design.js と同じ区間を eval） ----
function loadTypes(src) {
  const start = src.indexOf("const MATCH_TAGS=");
  const end = src.indexOf("function diagnose(");
  if (start < 0 || end < 0 || end <= start) throw new Error("shampoo/index.html から TYPES の区間を取り出せません（MATCH_TAGS〜diagnose の目印が変わった？）");
  const f = new Function("R1", "R2", "rak1", src.slice(start, end) + "\nreturn {TYPES};");
  return f("stub-r1/", "stub-r2", (id) => "stub/" + id).TYPES;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- タイプごとの見出し（検索で使われる言葉）。タイプ名・説明・ケア・商品はアプリの TYPES から取る ----
// h1 は「人が実際に検索する悩みの言葉」。振り分けの条件は diagnose() と食い違わないように書く
const TYPE_PAGES = {
  skin_alert:      { slug: "skin-alert",      h1: "頭皮に赤み・湿疹があるときのシャンプーの選び方" },
  oil_reset_short: { slug: "oil-reset-short", h1: "頭皮がべたつくショートヘアのシャンプーの選び方" },
  oil_reset_long:  { slug: "oil-reset-long",  h1: "頭皮がべたつくミディアム〜ロングヘアのシャンプーの選び方" },
  repair_mode:     { slug: "repair-mode",     h1: "ブリーチ毛のシャンプーの選び方" },
  curl_repair:     { slug: "curl-repair",     h1: "縮毛矯正・パーマをした、くせ毛のシャンプーの選び方" },
  silk_restore:    { slug: "silk-restore",    h1: "縮毛矯正・パーマをした、直毛のシャンプーの選び方" },
  smooth_wave:     { slug: "smooth-wave",     h1: "くせ毛・うねり・広がりが気になる髪のシャンプーの選び方" },
  aqua_sensitive:  { slug: "aqua-sensitive",  h1: "カラーやパーマをしていない髪（バージン毛）のシャンプーの選び方" },
  bare_skin:       { slug: "bare-skin",       h1: "カラーをしている髪（軽いダメージ）のシャンプーの選び方" },
  vital_aging:     { slug: "vital-aging",     h1: "年齢とともにハリ・コシが減ってきた髪のシャンプーの選び方" },
  volume_grace:    { slug: "volume-grace",    h1: "細い髪・少ない毛量でボリュームがほしい人のシャンプーの選び方" },
};
const charImg = (key) => "/char-" + key.replace(/_/g, "-") + ".webp";
const typeUrl = (key) => "/shampoo/type/" + TYPE_PAGES[key].slug + "/";

// ---- よくある質問（画面の文と構造化データの両方をここから作る） ----
const FAQ = [
  { q: "シャンプー診断は無料ですか？登録は必要ですか？",
    a: "無料です。会員登録やメールアドレスの入力もいりません。11問に答えると、その場で結果が出ます。所要時間は約2〜3分です。" },
  { q: "売りたい商品が上に出るのではないですか？",
    a: "並び順は、11問の答えと、商品ごとの全成分から付けた点数で決まります。Amazon・楽天のリンクから購入されると紹介料が入る仕組みはありますが、紹介料は点数に入っていません。また、どの答えでも1位にならない商品は載せない方針にしています。" },
  { q: "AIが診断しているのですか？",
    a: "診断の画面でAIは動いていません。答えからタイプと順位を出すのは、美容師の接客経験をもとに決めたルールと点数です。AIは、商品の成分を調べる下読みや、ルールに食い違いがないかの点検に使っています。" },
  { q: "ブリーチ毛・くせ毛・白髪でも使えますか？",
    a: "使えます。ブリーチ、縮毛矯正・パーマ、くせ毛、カラー、年齢によるハリ・コシの変化、細毛・ボリュームの悩みなどを、それぞれ別のタイプとして考えます。白髪やエイジングの悩みも、質問の中で答えられます。" },
  { q: "頭皮に赤みや湿疹があるときはどうすればいいですか？",
    a: "赤みや湿疹があるときは、シャンプーを選ぶ前に皮膚科の受診をおすすめします。シャンプーは薬ではないので、症状そのものを治すことはできません。診断では、頭皮への刺激を減らす方向のシャンプーをご提案します。" },
  { q: "診断のあと、美容師に相談できますか？",
    a: "できます。東京・原宿（明治神宮前）のGO TODAY SHAiRE SALON 原宿本店で、橋元リョウイチが担当しています。ご相談・ご予約はLINEで受け付けています。" },
];

// ---- ① /shampoo/ の「シャンプー診断について」 ----
function renderAbout(TYPES) {
  const types = Object.keys(TYPE_PAGES).map((k) => {
    const t = TYPES[k];
    return `<li><a href="${typeUrl(k)}"><img src="${charImg(k)}" alt="" width="896" height="1200" loading="lazy" decoding="async"><span class="t">${esc(t.title)}</span><span class="s">${esc(t.sub)}</span></a></li>`;
  }).join("\n");
  const faqHtml = FAQ.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join("\n");
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": FAQ.map((f) => ({ "@type": "Question", "name": f.q, "acceptedAnswer": { "@type": "Answer", "text": f.a } })),
  };
  return `<section id="about" class="seo-about" aria-label="シャンプー診断について">
<h2>シャンプー診断でわかること</h2>
<p>11の質問に答えると、髪と頭皮の状態から、あなたに合うシャンプーの選び方がわかります。無料・登録不要で、所要時間は約2〜3分です。</p>
<ul class="seo-list">
<li><b>髪と頭皮のタイプ</b>：11のタイプのうち、どれにあたるか</li>
<li><b>回答のまとめ</b>：答えから見えた、今の髪と頭皮の状態</li>
<li><b>ケアのポイント</b>：洗い方・乾かし方など、毎日のケアの考え方</li>
<li><b>合うシャンプー</b>：答えに合う順に並べた候補（Amazon・楽天で見られます）</li>
</ul>
<h2>11のタイプ</h2>
<p>タイプ名を押すと、そのタイプのケアのポイントと、候補になるシャンプーが見られます。</p>
<ul class="seo-types">
${types}
</ul>
<h2>診断のしくみ</h2>
<p>シャンプーの中身で、水の次に多いのが洗浄成分（界面活性剤）です。同じ「アミノ酸系」と書かれていても、ほかの洗浄成分との組み合わせや補修成分で、洗い上がりは大きく変わります。</p>
<p>この診断では、載せているシャンプー1本ずつの全成分（配合の順番）を確かめ、洗浄力・低刺激性・しっとり度・補修力・特化の強さの5つの軸で点数を付けています。11問の答えから「今の髪に合う目標」を決め、その目標に近い順に並べます。同じタイプでも、しっとりさせたいか、サラサラにしたいかで1位は入れ替わります。</p>
<p>頭皮が乾燥しやすい人や赤みがある人には、洗浄力の強いシャンプーが上に来ないようにしています。</p>
<h2>よくある質問</h2>
<div class="seo-faq">
${faqHtml}
</div>
<p><a href="${RESERVE_URL}" target="_blank" rel="noopener noreferrer" onclick="window.hrTrack&amp;&amp;window.hrTrack('shampoo_line_about')">LINEで相談する</a></p>
<h2>作った人</h2>
<p>橋元リョウイチ｜東京・原宿のフリーランス美容師（GO TODAY SHAiRE SALON 原宿本店）。美容師歴20年以上。サロンで毎日のように受けてきた「シャンプー、何がおすすめですか？」という質問に、成分と髪の構造から答えるために、この診断を作りました。</p>
<p><a href="/">橋元リョウイチのプロフィール</a></p>
<p><a href="#" class="seo-back">↑ 上に戻って、診断をはじめる</a></p>
<script type="application/ld+json">
${JSON.stringify(faqLd, null, 2)}
</script>
</section>`;
}

// ---- ② タイプごとのページ ----
function renderTypePage(key, TYPES) {
  const t = TYPES[key];
  const cfg = TYPE_PAGES[key];
  const url = SITE + typeUrl(key);
  const title = `${cfg.h1}｜${t.title}タイプ｜シャンプー診断 Hair Identity`;
  const firstAdvice = (t.advice.find((s) => !s.startsWith("※")) || "").replace(/\s+/g, " ");
  const descFull = `${t.title}（${t.sub}）タイプのケアのポイントと、候補になるシャンプー。${firstAdvice}`;
  const description = descFull.length > 118 ? descFull.slice(0, 118) + "…" : descFull;
  const advice = t.advice.filter((s) => !s.startsWith("※")).map((s) => `<li>${esc(s)}</li>`).join("\n");
  const notes = t.advice.filter((s) => s.startsWith("※")).map((s) => `<p class="note">${esc(s)}</p>`).join("\n");
  const products = t.products.filter((p) => !p.secondaryOnly).map((p) =>
    `<li><span class="pn">${esc(p.name)}</span>${p.forWhom ? `<span class="pw">${esc(p.forWhom)}</span>` : ""}${p.desc ? `<span class="pd">${esc(p.desc)}</span>` : ""}</li>`
  ).join("\n");
  const others = Object.keys(TYPE_PAGES).filter((k) => k !== key).map((k) =>
    `<li><a href="${typeUrl(k)}">${esc(TYPES[k].title)}<span>${esc(TYPES[k].sub)}</span></a></li>`
  ).join("\n");
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "橋元リョウイチ", "item": SITE + "/" },
        { "@type": "ListItem", "position": 2, "name": "シャンプー診断", "item": SITE + "/shampoo/" },
        { "@type": "ListItem", "position": 3, "name": `${t.title}（${t.sub}）`, "item": url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": title,
      "url": url,
      "inLanguage": "ja",
      "isPartOf": { "@id": SITE + "/#website" },
      "author": { "@id": SITE + "/#person" },
    },
  ];
  return `<!DOCTYPE html>
<!-- このページは scripts/build-seo-pages.js が shampoo/index.html の TYPES から書き出したもの。直接直さないこと -->
<html lang="ja">
<head>
<meta charset="UTF-8">
<script src="/measure.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="application-name" content="橋元リョウイチ">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="theme-color" content="#B8965A">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(cfg.h1)}｜${esc(t.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.jpg?v=3">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="橋元リョウイチ">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--cream:#F8F5F0;--ivory:#F2EBE0;--gold:#B8956A;--gold-l:#D4B896;--gold-d:#8A6843;--char:#28221C;--char2:#4A3E34;--muted:#8A7A6A;--border:rgba(184,149,106,0.22);--serif:"Cormorant Garamond",Georgia,serif;--sans:"Noto Sans JP",sans-serif;--r:3px}
html{font-size:17px}
body{background:var(--cream);color:var(--char2);font-family:var(--sans);line-height:1.9;-webkit-text-size-adjust:100%}
a{color:var(--gold-d)}
.top{text-align:center;padding:1.2rem 1rem;border-bottom:1px solid var(--border)}
.top a{text-decoration:none;color:var(--char);font-family:var(--serif);font-size:1.25rem;letter-spacing:.06em}
.top a span{display:block;font-family:var(--sans);font-size:.68rem;letter-spacing:.14em;color:var(--gold)}
main{max-width:680px;margin:0 auto;padding:1.4rem 1.5rem 3rem}
.crumb{font-size:.74rem;color:var(--muted);margin-bottom:1.6rem}
.crumb a{color:var(--muted)}
.hero{text-align:center;margin-bottom:1.8rem}
.hero img{width:46%;max-width:220px;aspect-ratio:896/1200;height:auto;object-fit:contain}
.eye{font-size:.7rem;letter-spacing:.16em;color:var(--gold);margin-top:.6rem}
h1{font-size:1.35rem;font-weight:500;color:var(--char);line-height:1.55;margin:.4rem 0 .6rem}
.type{font-family:var(--serif);font-size:1.3rem;color:var(--char)}
.type span{display:block;font-family:var(--sans);font-size:.82rem;color:var(--muted)}
.lead{margin:1.2rem 0}
h2{font-size:1.08rem;font-weight:500;color:var(--char);margin:2.4rem 0 .9rem;padding-left:.7rem;border-left:2px solid var(--gold)}
.alert{background:#fdf3ef;border:1px solid #e8c9bd;color:#8a4a3a;border-radius:var(--r);padding:.8rem 1rem;font-size:.88rem;margin:1rem 0}
ol.advice{padding-left:1.4em}
ol.advice li{margin:.5rem 0}
.note{font-size:.8rem;color:var(--muted);margin-top:.8rem}
ul.prods{list-style:none}
ul.prods li{border-bottom:1px dotted var(--border);padding:.8rem 0}
.pn{display:block;font-weight:500;color:var(--char)}
.pw{display:block;font-size:.82rem;color:var(--gold-d)}
.pd{display:block;font-size:.84rem}
.cta{text-align:center;margin:2.4rem 0 1rem;padding:1.6rem 1rem;background:rgba(255,255,255,.6);border:1px solid var(--border);border-radius:var(--r)}
.cta p{font-size:.88rem;margin-bottom:1rem}
.btn{display:inline-block;background:var(--gold);color:#fff;text-decoration:none;padding:.85rem 1.6rem;border-radius:999px;font-size:.95rem;letter-spacing:.04em}
@media (hover:hover) and (pointer:fine){.btn:hover{background:var(--gold-d)}}
ul.others{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
ul.others a{display:block;text-decoration:none;background:rgba(255,255,255,.55);border:1px solid var(--border);border-radius:var(--r);padding:.6rem .7rem;font-family:var(--serif);font-size:1rem;color:var(--char);line-height:1.3;height:100%}
ul.others a span{display:block;font-family:var(--sans);font-size:.7rem;color:var(--muted);margin-top:.2rem;line-height:1.5}
.author{font-size:.86rem;margin-top:2.4rem;padding-top:1.2rem;border-top:1px solid var(--border)}
footer{text-align:center;font-size:.74rem;color:var(--muted);padding:1.6rem 1rem 2.4rem;border-top:1px solid var(--border)}
footer a{color:var(--muted)}
</style>
</head>
<body>
<header class="top"><a href="/shampoo/"><span>シャンプー診断</span>Hair Identity</a></header>
<main>
<nav class="crumb" aria-label="現在地"><a href="/">橋元リョウイチ</a> › <a href="/shampoo/">シャンプー診断</a> › ${esc(t.title)}</nav>
<div class="hero">
<img src="${charImg(key)}" alt="${esc(t.title)}タイプのキャラクター" width="896" height="1200">
<p class="eye">${esc(t.badge)}</p>
<h1>${esc(cfg.h1)}</h1>
<p class="type">${esc(t.title)}<span>${esc(t.sub)}</span></p>
</div>
<p class="lead">シャンプー診断「Hair Identity」の11タイプのひとつ、<b>${esc(t.title)}</b>（${esc(t.sub)}）のケアの考え方と、候補になるシャンプーをまとめました。どのシャンプーが1位になるかは、なりたい仕上がり（しっとり・サラサラ・ボリュームなど）や頭皮の状態で変わります。11問の診断で、あなたの答えに合う順に並べられます。</p>
${t.alert ? `<p class="alert">${esc(t.alert)}</p>\n` : ""}<h2>${esc(t.title)}タイプのケアのポイント</h2>
<ol class="advice">
${advice}
</ol>
${notes}
<h2>${esc(t.title)}タイプで候補になるシャンプー（順不同）</h2>
<ul class="prods">
${products}
</ul>
<p class="note">並び順と1位は、11問の答えで決まります。購入ページへのリンクは、診断の結果画面にあります。</p>
<div class="cta">
<p>自分がこのタイプかどうか、どれが1位になるかを確かめる</p>
<a class="btn" href="/shampoo/">11問のシャンプー診断をはじめる（無料）</a>
</div>
<h2>ほかの10タイプ</h2>
<ul class="others">
${others}
</ul>
<p class="author">監修：<a href="/">橋元リョウイチ</a>｜東京・原宿のフリーランス美容師（GO TODAY SHAiRE SALON 原宿本店）。美容師歴20年以上。</p>
</main>
<footer><a href="/shampoo/">シャンプー診断</a> ・ <a href="/">橋元リョウイチ</a> ・ <a href="/privacy/">プライバシーポリシー</a></footer>
</body>
</html>
`;
}

// ---- ③ sitemap.xml の11タイプ分 ----
function renderSitemap(xml) {
  const lastmod = (xml.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1] || new Date().toISOString().slice(0, 10);
  const rows = Object.keys(TYPE_PAGES).map((k) =>
    `  <url>\n    <loc>${SITE}${typeUrl(k)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  ).join("\n");
  const block = `  <!-- TYPE-PAGES:START（scripts/build-seo-pages.js が書き出す） -->\n${rows}\n  <!-- TYPE-PAGES:END -->`;
  if (xml.includes("<!-- TYPE-PAGES:START")) {
    return xml.replace(/  <!-- TYPE-PAGES:START[\s\S]*?<!-- TYPE-PAGES:END -->/, block);
  }
  return xml.replace("</urlset>", block + "\n</urlset>");
}

// ---- 本体 ----
function main() {
  const app = readFile(APP);
  if (app == null) { console.error("✗ " + APP + " が読めません"); process.exit(1); }
  const TYPES = loadTypes(app);
  for (const k of Object.keys(TYPES)) if (!TYPE_PAGES[k]) { console.error(`✗ TYPES に新しいタイプ「${k}」があります。scripts/build-seo-pages.js の TYPE_PAGES に見出しを足してください`); process.exit(1); }
  for (const k of Object.keys(TYPE_PAGES)) if (!TYPES[k]) { console.error(`✗ TYPE_PAGES の「${k}」がアプリの TYPES にありません`); process.exit(1); }

  const S = "<!-- SEO-ABOUT:START", E = "<!-- SEO-ABOUT:END -->";
  const si = app.indexOf(S), ei = app.indexOf(E);
  if (si < 0 || ei < 0 || ei < si) { console.error("✗ " + APP + " に SEO-ABOUT の目印がありません"); process.exit(1); }
  const startTagEnd = app.indexOf("-->", si) + 3;
  const newApp = app.slice(0, startTagEnd) + "\n" + renderAbout(TYPES) + "\n" + app.slice(ei);

  const outputs = [[APP, newApp]];
  for (const k of Object.keys(TYPE_PAGES)) outputs.push([`shampoo/type/${TYPE_PAGES[k].slug}/index.html`, renderTypePage(k, TYPES)]);
  const sm = readFile(SITEMAP);
  if (sm != null) outputs.push([SITEMAP, renderSitemap(sm)]);

  if (CHECK) {
    // sitemap の lastmod は sync-sitemap.sh がコミット時に動かすので比べない
    const norm = (rel, s) => (rel === SITEMAP ? s.replace(/<lastmod>[^<]*<\/lastmod>/g, "<lastmod/>") : s);
    const stale = outputs.filter(([rel, want]) => { const have = readFile(rel); return have == null || norm(rel, have) !== norm(rel, want); }).map(([rel]) => rel);
    if (stale.length) {
      console.error("✗ 検索向けページが最新ではありません: " + stale.join(", "));
      console.error("  → `node scripts/build-seo-pages.js` を実行し、書き出されたファイルもコミットに含めてください（タイプ名・説明・商品を変えたときに起きます）");
      process.exit(1);
    }
    console.log("✓ 検索向けページ（/shampoo/ の説明・11タイプのページ・sitemap）は最新");
    return;
  }
  let changed = 0;
  for (const [rel, body] of outputs) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8") === body) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    console.log("書き出し: " + rel);
    changed++;
  }
  console.log(changed ? `✓ ${changed} ファイルを書き出しました` : "✓ 変更なし（すべて最新）");
}
main();
