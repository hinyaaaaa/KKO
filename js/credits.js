// js/credits.js — クレジット表示(選択画面の「クレジット」から開く)
// 各モデルの利用規約が求める権利表記と、「非公式」であることをここにまとめる。
// 表記が必要なキャラは、characters-data.js の credit に文言を書く(例: '© 2019 cover corp.')。
export function initCredits(characters) {
  const btn = document.getElementById('credits-btn');
  const sheet = document.getElementById('credits-sheet');
  const closeBtn = document.getElementById('credits-close');
  const body = document.getElementById('credits-body');
  if (!btn || !sheet || !body) return;

  const rows = characters.map((c) => `<dt>${c.name}</dt><dd>${c.credit || 'ホロライブ公式配布モデル(配布元の利用規約に従って使用)'}</dd>`).join('');
  body.innerHTML = `
    <p>KKOは、個人が作った非公式のファン作品です。ホロライブプロダクションおよびカバー株式会社とは関係ありません。</p>
    <p>キャラクターのモデルは、このアプリに含まれていません。利用者が配布元から入手し、それぞれの利用規約に従って、自分の端末の中だけで使います。</p>
    <dl>${rows}</dl>`;

  const open = () => { sheet.classList.add('show'); closeBtn.focus(); };
  const close = () => { sheet.classList.remove('show'); btn.focus(); };
  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('show')) close(); });
}
