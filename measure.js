/* 計測（Microsoft Clarity＝クリック・スクロールの記録／GA4＝人数・流入元・ボタンが押された回数）
   トップ・ナノピコ・シャンプー診断の <head> から読み込む。IDを変えるときはここだけ直す。 */
(function () {
  var CLARITY_ID = 'ypcp765n4v';
  var GA_ID = 'G-CXGHZETDWS';

  // ボタンや診断の進み具合を名前つきで送る。本番以外では clarity/gtag が無いので何もしない
  window.hrTrack = function (name, params) {
    try { if (window.clarity) window.clarity('event', name); } catch (e) {}
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {}
  };

  // 本番のアドレスで開いたときだけ計測する（手元の確認用の表示を混ぜない）
  if (!/(^|\.)hashimoto-ryoichi\.com$/.test(location.hostname)) return;

  // 橋元さん・Claudeの確認用の訪問に「内部」の印を付ける（GA4の内部トラフィック除外・Clarityの絞り込みで外す）
  //   ?internal=1 … この端末（ブラウザ）を以後ずっと内部扱いにする／?internal=0 で解除
  //   ?chk=… ・?admin=1 … その表示だけ内部扱い
  var q = location.search, internal = /[?&](chk|admin)=/.test(q);
  try {
    if (/[?&]internal=1(&|$)/.test(q)) localStorage.setItem('hr_internal', '1');
    if (/[?&]internal=0(&|$)/.test(q)) localStorage.removeItem('hr_internal');
    if (localStorage.getItem('hr_internal') === '1') internal = true;
  } catch (e) {}

  function load(src) {
    var s = document.createElement('script'); s.async = true; s.src = src;
    document.head.appendChild(s);
  }

  // Microsoft Clarity
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  load('https://www.clarity.ms/tag/' + CLARITY_ID);
  if (internal) window.clarity('set', 'internal', '1');

  // GA4
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, internal ? { traffic_type: 'internal' } : {});
  load('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
})();
