// js/pose-ring.js — ポーズ/表情のチップ選択
// ------------------------------------------------------------
// カテゴリ(ポーズ・表情)ごとに、横にスクロールできるチップの行を常時2段表示する。
// 項目はタップで直接選べる(旧: 矢印とスワイプで1つずつ送る方式)。選んでいる項目は推しカラーで塗る。
// 絵文字は使わない。ラベルの文字だけで見分けられるようにする。
//
// main.jsが呼ぶ公開APIの形は変えていない:
//   window.PoseRing.init(categoryList, onSelectCallback)
//   window.PoseRing.setActive(categoryKey, itemKey)
//   window.PoseRing.syncPosition()
(function () {
  let cats = [];
  let onSelect = null;
  let rootEl = null;

  function markPressed(cat) {
    cat.chips.forEach((chip, i) => chip.setAttribute('aria-pressed', i === cat.sel ? 'true' : 'false'));
  }

  function scrollIntoStrip(cat, smooth) {
    const chip = cat.chips[cat.sel];
    if (!chip || !cat.stripEl) return;
    const strip = cat.stripEl;
    const target = chip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }

  function select(cat, idx, fromUser) {
    if (!cat.items.length) return;
    cat.sel = idx;
    markPressed(cat);
    scrollIntoStrip(cat, true);
    if (fromUser && typeof onSelect === 'function') onSelect(cat.key, cat.items[idx].key, cat.items[idx]);
  }

  function buildRow(cat) {
    const row = document.createElement('div');
    row.className = 'pose-ring-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', cat.label);

    const label = document.createElement('span');
    label.className = 'pose-ring-label';
    label.textContent = cat.label;

    const strip = document.createElement('div');
    strip.className = 'chip-strip';
    cat.chips = cat.items.map((item, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = item.label;
      chip.setAttribute('aria-pressed', i === cat.sel ? 'true' : 'false');
      chip.addEventListener('click', () => select(cat, i, true));
      strip.appendChild(chip);
      return chip;
    });
    cat.stripEl = strip;

    row.appendChild(label);
    row.appendChild(strip);
    return row;
  }

  /**
   * @param {Array<{key:string,label:string,items:Array<{key:string,label:string}>}>} categoryList
   * @param {(catKey:string,itemKey:string,item:object)=>void} onSelectCallback
   */
  function init(categoryList, onSelectCallback) {
    cats = categoryList.map((c) => Object.assign({ sel: 0 }, c));
    onSelect = onSelectCallback || null;
    rootEl = document.getElementById('pose-rings');
    if (!rootEl) return;
    rootEl.innerHTML = '';
    cats.forEach((cat) => rootEl.appendChild(buildRow(cat)));
  }

  /** 外部から選択状態だけ合わせる(onSelectは呼ばない) */
  function setActive(categoryKey, itemKey) {
    const cat = cats.find((c) => c.key === categoryKey);
    if (!cat) return;
    const idx = cat.items.findIndex((it) => it.key === itemKey);
    if (idx < 0) return;
    select(cat, idx, false);
  }

  /** API互換のためだけに残すno-op */
  function syncPosition() {}

  window.PoseRing = { init, setActive, syncPosition };
})();
