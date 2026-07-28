#!/usr/bin/env node
// Hair Identity — 本番 index.html からタイプ別の商品一覧を出力する。
//
// ドキュメントに商品表を書き写すと必ず腐り、腐った記述が事故になる（2026-07-29の教訓）。
// 「一覧が見たい」ときは書き写しを読まず、これを実行すること。
//
//   node scripts/dump-products.js          # Markdown表
//   node scripts/dump-products.js --json   # JSON

"use strict";
const fs = require("fs");
const path = require("path");

const INDEX = path.join(__dirname, "..", "index.html");
const src = fs.readFileSync(INDEX, "utf8");
const block = src.slice(src.indexOf("const MATCH_TAGS="), src.indexOf("function diagnose("));
const R1 = (src.match(/const R1="([^"]*)"/) || [])[1] || "";
const R2 = (src.match(/const R2="([^"]*)"/) || [])[1] || "";
const ASSOC = (src.match(/const ASSOC_ID="([^"]*)"/) || [])[1] || "(未検出)";

const M = new Function("R1", "R2", "rak1",
  block + "\nreturn {TYPES, ING_PROFILES, MATCH_TAGS};")(R1, R2, (id) => R1 + id + "/" + R2);

const uniq = new Map();
let registered = 0;
for (const tk in M.TYPES) {
  for (const p of M.TYPES[tk].products) {
    registered++;
    if (!uniq.has(p.name)) uniq.set(p.name, { ...p, types: [] });
    uniq.get(p.name).types.push(tk);
  }
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify([...uniq.values()].map((p) => ({
    name: p.name, amz: p.amz || null, rakUrl: p.rakUrl || null,
    scent: p.scent || null, otc: !!p.otc, top: !!p.top, types: p.types,
  })), null, 1));
  process.exit(0);
}

console.log(`# 商品一覧（${INDEX} から生成）\n`);
console.log(`アソシエイトID: ${ASSOC}`);
console.log(`ユニーク ${uniq.size}点 / 登録 ${registered} / ING_PROFILES ${M.ING_PROFILES.length} / MATCH_TAGS ${M.MATCH_TAGS.length}`);
console.log(`ASINあり ${[...uniq.values()].filter((p) => p.amz).length}点 / 楽天専売 ${[...uniq.values()].filter((p) => !p.amz).length}点\n`);
console.log("★=top:true（TOP PICKの同点タイブレーク）　🏥=otc:true（医薬部外品・界面活性剤チャートから除外）\n");

for (const tk in M.TYPES) {
  const t = M.TYPES[tk];
  console.log(`## \`${tk}\` — ${t.title}（${t.sub}）${t.products.length}商品\n`);
  console.log("| 商品 | ASIN | 香り | フラグ |");
  console.log("|---|---|---|---|");
  for (const p of t.products) {
    const flags = [p.top && "★", p.otc && "🏥", p.tostera && "tostera",
      p.heavyMoisture && "heavyMoisture", p.volumeUp && "volumeUp",
      p.curlAvoid && "curlAvoid"].filter(Boolean).join(" ");
    console.log(`| ${p.name} | ${p.amz || "null（楽天専売）"} | ${p.scent || "—"} | ${flags} |`);
  }
  console.log("");
}

const noScent = [...uniq.values()].filter((p) => !p.scent);
if (noScent.length) {
  console.log("## 香り未確認（scentなし）\n");
  noScent.forEach((p) => console.log("- " + p.name));
}
