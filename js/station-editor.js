// 駅メモ係(施主)が、駅のメモ(グルメトップ3・地元の一押し・TVで紹介)を入れる画面。
// 確認日と根拠のリンクは必須。施主が自分で確かめた物だけ。出演者の名前を根拠にしない。番組の文章・写真は写さない。
import { checkGourmetList, checkLocalPick, checkTv } from './station-notes.js';

const RULES = [
  '施主が自分で確かめた物だけを書きます(AIや検索の答えを、確かめずにそのまま書かない)。',
  'グルメは「確認日」と「根拠のリンク」(店や自治体の公式など)が必須です。',
  'TVの紹介は、番組名・放送日・出典のリンクだけ。番組の文章や写真は写しません。',
  '「○○さん(出演者)のおすすめ」のように、出演者の名前を根拠にした書き方はしません。',
  '地元の一押しは「誰に聞いたか」(例: 直売所の方。個人名は書かない)と「聞いた日」も書きます。',
];

// sheet: 画面を入れる要素。station: 駅。data: { note, gourmet[], tv[] }(その駅の分)
// onSave({ note, gourmet, tvAdd, tvDelete }) は保存の処理(失敗したら例外)。onClose() は閉じた時
export function openStationEditor(sheet, { station, data, onSave, onClose }) {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const input = (type, value, placeholder, name) => {
    const i = document.createElement('input');
    i.type = type;
    i.value = value || '';
    if (placeholder) i.placeholder = placeholder;
    if (name) i.name = name;
    return i;
  };
  const field = (label, control) => {
    const l = el('label', 'field', label);
    l.append(control);
    return l;
  };

  const head = el('div', 'picker-head');
  const closeBtn = el('button', 'btn sub picker-close', '閉じる');
  closeBtn.type = 'button';
  head.append(el('h2', 'sheet-title', `道の駅 ${station.name} のメモ`), closeBtn);

  const rules = el('ul', 'editor-rules');
  for (const r of RULES) rules.append(el('li', null, r));

  // グルメトップ3
  const gSection = el('fieldset', 'editor-section');
  gSection.append(el('legend', null, 'グルメトップ3'));
  const gRows = [1, 2, 3].map((rank) => {
    const cur = data.gourmet.find((g) => g.rank === rank) || {};
    const row = {
      rank,
      dish: input('text', cur.dish, '料理名', `g${rank}-dish`),
      shop: input('text', cur.shop, '店名', `g${rank}-shop`),
      confirmedOn: input('date', cur.confirmedOn, '', `g${rank}-date`),
      sourceUrl: input('url', cur.sourceUrl, 'https://…(根拠のリンク)', `g${rank}-url`),
    };
    const box = el('div', 'editor-row');
    box.append(el('p', 'editor-rank', `${rank}位`), row.dish, row.shop, field('確認日', row.confirmedOn), row.sourceUrl);
    gSection.append(box);
    return row;
  });

  // 地元の一押し
  const lSection = el('fieldset', 'editor-section');
  lSection.append(el('legend', null, '地元の人の一押し'));
  const local = {
    text: input('text', data.note?.localPick, '一言(100文字まで)', 'local-text'),
    from: input('text', data.note?.localPickFrom, '誰に聞いたか(例: 直売所の方)', 'local-from'),
    on: input('date', data.note?.localPickOn, '', 'local-date'),
  };
  lSection.append(local.text, local.from, field('聞いた日', local.on));

  // TVで紹介
  const tSection = el('fieldset', 'editor-section');
  tSection.append(el('legend', null, 'TVで紹介'));
  const tvDelete = new Set();
  for (const t of data.tv) {
    const row = el('div', 'editor-tv-item');
    row.append(el('span', null, `${t.program}(${t.airedOn})`));
    const del = el('button', 'btn sub', '消す');
    del.type = 'button';
    del.addEventListener('click', () => {
      tvDelete.add(t.id);
      row.classList.add('deleted');
      del.disabled = true;
    });
    row.append(del);
    tSection.append(row);
  }
  const tv = {
    program: input('text', '', '番組名', 'tv-program'),
    airedOn: input('date', '', '', 'tv-date'),
    sourceUrl: input('url', '', 'https://…(出典のリンク)', 'tv-url'),
    note: input('text', '', '一言(60文字まで・自分の言葉で)', 'tv-note'),
  };
  tSection.append(el('p', 'editor-hint', '新しく足す時だけ書く:'), tv.program, field('放送日', tv.airedOn), tv.sourceUrl, tv.note);

  const error = el('p', 'login-error editor-error');
  error.setAttribute('role', 'alert');
  const save = el('button', 'btn main wide', '保存');
  save.type = 'button';

  function collect() {
    const v = (i) => i.value.trim();
    const gourmet = [];
    for (const r of gRows) {
      const vals = [v(r.dish), v(r.shop), v(r.confirmedOn), v(r.sourceUrl)];
      if (vals.every((x) => !x)) continue; // その順位は空(書かない)
      gourmet.push({ rank: r.rank, dish: vals[0], shop: vals[1], confirmedOn: vals[2], sourceUrl: vals[3] });
    }
    const note = {
      stationId: station.id, stationName: station.name,
      localPick: v(local.text) || null, localPickFrom: v(local.from) || null, localPickOn: v(local.on) || null,
    };
    const tvAdd = [];
    if ([v(tv.program), v(tv.airedOn), v(tv.sourceUrl), v(tv.note)].some(Boolean)) {
      tvAdd.push({ program: v(tv.program), airedOn: v(tv.airedOn), sourceUrl: v(tv.sourceUrl), note: v(tv.note) });
    }
    return { note, gourmet, tvAdd, tvDelete: [...tvDelete] };
  }

  save.addEventListener('click', async () => {
    const payload = collect();
    const problem = checkGourmetList(payload.gourmet) || checkLocalPick(payload.note) || payload.tvAdd.map(checkTv).find(Boolean);
    if (problem) {
      error.textContent = problem;
      return;
    }
    save.disabled = true;
    error.textContent = '';
    try {
      await onSave(payload);
      close();
    } catch (e) {
      error.textContent = e.message.includes('電波') ? '電波のある所で保存してください' : e.message;
      save.disabled = false;
    }
  });

  function close() {
    sheet.hidden = true;
    sheet.replaceChildren();
    onClose?.();
  }
  closeBtn.addEventListener('click', close);

  sheet.replaceChildren(head, rules, gSection, lSection, tSection, error, save);
  sheet.hidden = false;
}
