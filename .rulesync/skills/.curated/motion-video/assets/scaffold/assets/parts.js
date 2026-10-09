// 共通の部品の例: 項目の箱を縦に積んだ列。場面をまたいで同じ所に残って見える物（柱・地図・机の上の物など）は、
// データ（content.json）と姿勢（content.json の scenes[].pose の key。ここでは boxes）を受けて描く関数にする。
// 出す場面はどれも、場面の始まりの姿勢でこの関数から描き直し、前の場面から DOM や状態を受け取らない。
// 前の場面の終わりの姿勢と次の場面の始まりの姿勢が同じなら、帯の縁の左右や見出しの入れ替えの前後で同じ絵が続いて見える。
// scenes.js の後に読み込む
(function () {
  "use strict";
  const BOX = { w: 380, h: 92, gap: 18, radius: 18, border: 4 }; // 倍率 1 の大きさ

  // pose は { x（左端）, y（上端）, scale（倍率） }。戻り値は { el, side(i)（線を引き出す点）, dim(map)（箱 i を薄く 0〜1） }
  B.boxes = function (el, pose) {
    const k = pose.scale;
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { position: "absolute", left: "0px", top: "0px", width: "1920px", height: "1080px" });
    el.appendChild(wrap);
    const items = B.CONTENT.items.map((it, i) => {
      const box = document.createElement("div");
      const y = pose.y + i * (BOX.h + BOX.gap) * k;
      Object.assign(box.style, {
        position: "absolute", left: pose.x + "px", top: y + "px", width: BOX.w * k + "px", height: BOX.h * k + "px",
        display: "flex", alignItems: "center", gap: 16 * k + "px", padding: `0 ${24 * k}px`, boxSizing: "border-box",
        borderRadius: BOX.radius * k + "px", border: `${BOX.border * k}px solid var(--ink)`, background: "var(--panel)",
        fontWeight: "700", fontSize: 34 * k + "px", lineHeight: "1", whiteSpace: "nowrap",
      });
      // 字は薄くする幕の下に入ることがある（意図どおりなので、検査の text_occluded から外す）
      box.innerHTML = `<span style="flex:none;width:${18 * k}px;height:${18 * k}px;border-radius:50%;background:${it.color}"></span><span data-layout-allow-occlusion>${it.label}</span>`;
      wrap.appendChild(box);
      // 薄くする幕（地の色で覆う）
      const veil = document.createElement("div");
      Object.assign(veil.style, { position: "absolute", inset: `-${BOX.border * k}px`, borderRadius: BOX.radius * k + "px", background: "var(--bg)", opacity: 0 });
      box.appendChild(veil);
      return { box, veil, y };
    });
    return {
      el: wrap,
      side: (i) => ({ x: pose.x + BOX.w * k, y: items[i].y + (BOX.h * k) / 2 }),
      dim: (map) => items.forEach((it, i) => { it.veil.style.opacity = (0.7 * (map[i] || 0)).toFixed(3); }),
    };
  };
})();
