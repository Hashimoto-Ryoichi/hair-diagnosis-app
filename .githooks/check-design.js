#!/usr/bin/env node
// Hair Identity 設計整合チェック（Top Pick＝回答主導設計の守り）
// 使い方: node .githooks/check-design.js [index.htmlのパス]
// pre-commit から自動実行される。--no-verify で飛ばさないこと。
//
// 検査項目:
//  1. 全商品が ING_PROFILES に登録されている（未登録だと成分マッチ0点になり順位が壊れる）
//  2. 商品名が ING_PROFILES / MATCH_TAGS の複数キーに一致しない（部分一致事故の防止）
//  3. 各タイプに top:true がちょうど1件
//  4. top ボーナスが +1 のまま（+2 に戻すと回答主導の設計が壊れる）
//  5. 中核関数・データ（diagnose / desiredProfile / scoreProduct / ING_PROFILES / MATCH_TAGS）が存在
//  6. シナリオ実走: 全タイプで代表回答のスコア順位が計算でき、1位スコアが正の値になる

"use strict";
const fs = require("fs");
const file = process.argv[2] || "index.html";
const src = fs.readFileSync(file, "utf8");
let ng = 0;
const fail = (msg) => { console.error("✗ " + msg); ng++; };
const ok = (msg) => console.log("✓ " + msg);

// ---- 5. 中核の存在チェック ----
for (const marker of ["const MATCH_TAGS=", "const ING_PROFILES=", "function desiredProfile(", "function scoreProduct(", "function diagnose(", "const TYPES="]) {
  if (!src.includes(marker)) fail("中核が見つからない: " + marker);
}
if (ng) { console.error("中核構造が変わっています。check-design.js の抽出マーカーも合わせて更新してください。"); process.exit(1); }

// ---- 4. top ボーナス +1 チェック ----
if (/if\(product\.top\)\{\s*s\+=1;/.test(src)) {
  ok("top ボーナスは +1（回答主導の設計を維持）");
} else {
  fail("top ボーナスが +1 の形で見つからない（+2 等に変えると成分マッチより定番が勝ってしまう）");
}

// ---- データ抽出（MATCH_TAGS〜TYPES を eval。rak1 等はスタブ） ----
const start = src.indexOf("const MATCH_TAGS=");
const end = src.indexOf("function diagnose(");
if (start < 0 || end < 0 || end <= start) { fail("データ区間の抽出に失敗"); process.exit(1); }
const block = src.slice(start, end);
let MATCH_TAGS, ING_PROFILES, TYPES, scoreProduct, desiredProfile, isProductDisplayable;
try {
  const sandbox = new Function(
    "R1", "R2", "rak1",
    block + "\nreturn {MATCH_TAGS, ING_PROFILES, TYPES, scoreProduct, desiredProfile, isProductDisplayable};"
  );
  ({ MATCH_TAGS, ING_PROFILES, TYPES, scoreProduct, desiredProfile, isProductDisplayable } =
    sandbox("stub-r1/", "stub-r2", (id) => "stub/" + id));
} catch (e) {
  fail("データ区間の eval に失敗: " + e.message);
  process.exit(1);
}

// ---- 1・2. 全商品の ING_PROFILES / MATCH_TAGS 整合 ----
const names = new Map(); // name -> typeKeys
for (const tk in TYPES) for (const p of TYPES[tk].products) {
  if (!names.has(p.name)) names.set(p.name, []);
  names.get(p.name).push(tk);
}
let ingMiss = 0, tagMiss = 0, collide = 0;
for (const [name, tks] of names) {
  const ingHits = ING_PROFILES.filter((m) => name.includes(m.key));
  const tagHits = MATCH_TAGS.filter((m) => name.includes(m.key));
  if (ingHits.length === 0) { fail(`ING_PROFILES 未登録: [${tks}] ${name} — 成分解析7ステップ（ingredient_scoring.md）を実行して登録すること`); ingMiss++; }
  if (ingHits.length > 1) { fail(`ING_PROFILES 複数キー一致: ${name} → ${ingHits.map((m) => m.key).join(", ")}（keyを商品固有の文字列に）`); collide++; }
  if (tagHits.length > 1) { fail(`MATCH_TAGS 複数キー一致: ${name} → ${tagHits.map((m) => m.key).join(", ")}`); collide++; }
  if (tagHits.length === 0) { console.log(`  (注意) MATCH_TAGS 未登録: ${name} — 任意だが微調整が効かない`); tagMiss++; }
}
if (!ingMiss) ok(`全 ${names.size} 商品が ING_PROFILES に登録済み`);
if (!collide) ok("キーの部分一致衝突なし");

// ---- 3. top:true は各タイプ1件 ----
let topNg = 0;
for (const tk in TYPES) {
  const n = TYPES[tk].products.filter((p) => p.top).length;
  if (n !== 1) { fail(`top:true が ${n} 件: ${tk}（各タイプちょうど1件にする）`); topNg++; }
}
if (!topNg) ok("top:true は全タイプで1件ずつ");

// ---- 6. シナリオ実走（全タイプで順位計算が壊れていないか） ----
const SCENARIOS = {
  skin_alert:      { q1: "red", q2: "short", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["none"], q8: [], q10: ["moist"], q11: ["dry"] },
  oil_reset_short: { q1: "oily", q2: "short", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["none"], q8: [], q10: ["smooth"], q11: ["oily"] },
  oil_reset_long:  { q1: "oily", q2: "long", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["color"], q8: ["dry"], q10: ["moist"], q11: ["oily"] },
  repair_mode:     { q1: "normal", q2: "medium", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["bleach"], q8: ["dry", "split"], q10: ["moist"], q11: ["repair"] },
  smooth_wave:     { q1: "normal", q2: "medium", q3: "normal", q4: "normal", q5: "stable", q6: "strong", q7: ["none"], q8: ["frizz"], q10: ["smooth"], q11: ["wave"] },
  aqua_sensitive:  { q1: "normal", q2: "medium", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["none"], q8: [], q10: ["moist"], q11: [] },
  bare_skin:       { q1: "normal", q2: "medium", q3: "normal", q4: "normal", q5: "stable", q6: "none", q7: ["color"], q8: ["dry"], q10: ["gloss"], q11: [] },
  vital_aging:     { q1: "dry", q2: "medium", q3: "fine", q4: "normal", q5: "strong", q6: "none", q7: ["color"], q8: ["dry"], q10: ["moist"], q11: ["aging"] },
  volume_grace:    { q1: "normal", q2: "short", q3: "fine", q4: "less", q5: "stable", q6: "none", q7: ["none"], q8: ["flat"], q10: ["volume"], q11: ["volume"] },
};
let scenNg = 0;
for (const tk in TYPES) {
  const ans = SCENARIOS[tk];
  if (!ans) { fail(`シナリオ未定義の新タイプ: ${tk} — check-design.js の SCENARIOS に代表回答を追加すること`); scenNg++; continue; }
  const ranked = [...TYPES[tk].products]
    .filter((p) => isProductDisplayable(p, ans) && !p.secondaryOnly)
    .sort((a, b) => {
      if (!!a.gentleBottom !== !!b.gentleBottom) return a.gentleBottom ? 1 : -1;
      return scoreProduct(b, ans) - scoreProduct(a, ans);
    });
  if (ranked.length === 0) { fail(`シナリオ実走: ${tk} で表示可能な商品が0件`); scenNg++; continue; }
  const topScore = scoreProduct(ranked[0], ans);
  if (!(topScore > 0)) { fail(`シナリオ実走: ${tk} の1位スコアが ${topScore}（成分マッチが効いていない疑い）`); scenNg++; }
}
if (!scenNg) ok("シナリオ実走: 全タイプで順位計算が正常（1位スコア正常値）");

// ---- 7. 界面活性剤チャートの網羅（2026-08-04追加） ----
// おすすめに出るのにチャートのどの系統にも名前が出ない商品は、見た人が理由を確認できない。
// 例外は otc:true（医薬部外品＝下の注記で説明）と noSurf:true（界面活性剤を主体にしない処方＝専用注記で説明）。
const sdStart = src.indexOf("const SURFACTANT_DETAIL=");
const sdEnd = src.indexOf("function SurfactantChart(");
if (sdStart < 0 || sdEnd < 0 || sdEnd <= sdStart) {
  fail("SURFACTANT_DETAIL の抽出に失敗（チャートの構造が変わった可能性）");
} else {
  let SURFACTANT_DETAIL;
  try {
    SURFACTANT_DETAIL = new Function(src.slice(sdStart, sdEnd) + "\nreturn SURFACTANT_DETAIL;")();
  } catch (e) {
    fail("SURFACTANT_DETAIL の eval に失敗: " + e.message);
  }
  if (SURFACTANT_DETAIL) {
    const inChart = (p) => SURFACTANT_DETAIL.some((g) => g.products.some((pn) => p.name.includes(pn)));
    let chartNg = 0;
    for (const tk in TYPES) for (const p of TYPES[tk].products) {
      if (p.otc || p.noSurf) continue;
      if (!inChart(p)) {
        fail(`界面活性剤チャートに出ない商品: [${tk}] ${p.name} — 該当系統の products に追記するか、界面活性剤を主体にしない処方なら noSurf:true を付ける`);
        chartNg++;
      }
    }
    if (!chartNg) ok("界面活性剤チャート: おすすめ商品がすべていずれかの系統に出る");

    // ---- 8. 実際の描画セットとの照合（2026-08-04追加） ----
    // 経緯: 「ボリュームアップをお望みの方へ」等の追加セクションの商品選定が描画側にベタ書きで、
    // チャートの集計対象から漏れていた（画面には出ているのに系統に名前が出ない）。
    // allShownProducts が結果画面の商品の単一の正本。描画とチャートが両方これを使う。
    const hStart = src.indexOf("function findSecondarySection(");
    const hEnd = src.indexOf("// 🔬 診断透明化エンジン");
    if (hStart < 0 || hEnd < 0 || hEnd <= hStart) {
      fail("allShownProducts の抽出に失敗（結果画面の商品選定の構造が変わった可能性）");
    } else {
      let H = {};
      try {
        H = new Function("TYPES", "isProductDisplayable", src.slice(hStart, hEnd) +
          "\nreturn {allShownProducts,findSecondarySection,findFungalProducts,findVitalAgingProducts,findVolumeProducts};")(TYPES, isProductDisplayable);
      } catch (e) {
        fail("結果画面の商品選定（allShownProducts 一式）の eval に失敗: " + e.message);
      }
      if (typeof H.allShownProducts === "function") {
        // 追加セクション（フケかゆみ／ハリコシ／ボリューム）が出る回答も混ぜて走らせる
        const variants = (base) => [
          base,
          { ...base, q5: ["clear"] },
          { ...base, q4: "less", q8: [...(base.q8 || []), "flat"], q10: [...(base.q10 || []), "volume"], q11: [...(base.q11 || []), "volume"] },
        ];
        let shownNg = 0, aggNg = 0;
        for (const tk in TYPES) for (const ans of variants(SCENARIOS[tk] || {})) {
          const shown = H.allShownProducts(tk, ans);
          // (a) 集計されている商品は必ずチャートに出る
          for (const p of shown) {
            if (p.otc || p.noSurf || inChart(p)) continue;
            fail(`結果画面に出るのにチャートに出ない商品: [${tk}] ${p.name}`);
            shownNg++;
          }
          // (b) 各セクションの商品が漏れなく集計に入っている（今回のバグの本体）
          const sec = H.findSecondarySection(tk, ans);
          const parts = [
            ...TYPES[tk].products.filter((p) => isProductDisplayable(p, ans)),
            ...((sec && sec.products) ? sec.products.filter(Boolean) : []),
            ...H.findFungalProducts(tk, ans),
            ...H.findVitalAgingProducts(tk, ans),
            ...H.findVolumeProducts(tk, ans),
          ];
          const names = new Set(shown.map((p) => p.name));
          for (const p of parts) {
            if (names.has(p.name)) continue;
            fail(`allShownProducts が取りこぼしているセクション商品: [${tk}] ${p.name}`);
            aggNg++;
          }
        }
        if (!shownNg && !aggNg) ok("界面活性剤チャート: 追加セクションを含む結果画面の全商品を集計できている");
      }
      // 新しい商品セクションを足したのに allShownProducts へ繋ぎ忘れる事故を防ぐ
      // （renderProdCard の呼び出し箇所: 定義1 + 呼び出し5 = 6）
      const cardRefs = (src.match(/renderProdCard\(/g) || []).length;
      if (cardRefs !== 6) {
        fail(`renderProdCard の出現数が ${cardRefs} 件（想定6件＝定義1＋呼び出し5）。商品セクションを増減したなら、その商品を allShownProducts にも通したうえでこの数を更新すること`);
      } else {
        ok("商品セクションの数に変化なし（新セクションの集計漏れなし）");
      }
    }
  }
}

// ---- 結果 ----
if (ng) {
  console.error(`\n✗ 設計整合チェック失敗: ${ng} 件。Top Pick設計（回答主導）が壊れる恐れがあります。修正してから commit してください。`);
  process.exit(1);
}
console.log("\n✓ 設計整合チェック OK（Top Pick＝回答主導設計は維持されています）");
