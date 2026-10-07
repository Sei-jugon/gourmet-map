// 「道の駅を選ぶ」一覧(あとから登録で使う)。
// - 並び順: 近い順(現在地の許可があれば現在地から、なければ地図の中心から)/県ごと
// - 絞り込み: すべて/未だけ/済だけ。県ごとの「済/全体」の数
// - 済=その人自身の記録(300m以内)か、手で付けた「行った」。済の駅は、分かれば行った日を出す
import { distanceM } from './michi-layer.js';

const prefOrder = (stations) => [...new Set(stations.map((s) => s.pref))];

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

function fmtDay(day) {
  if (!day) return '';
  const [y, m, d] = day.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

// sheet: 一覧を入れる要素。stations: 駅の配列。visited: Map(id → {date})。
// origin: { lat, lng, label }。onPick(station) で選んだ駅を返す。onClose() で閉じた時
export function openStationPicker(sheet, { stations, visited, origin, onPick, onClose }) {
  const state = { filter: 'all', sort: 'near' };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const btn = (cls, text, fn) => {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  function render() {
    const head = el('div', 'picker-head');
    head.append(el('h2', 'sheet-title', '道の駅を選ぶ'), btn('btn sub picker-close', '閉じる', close));

    const filters = el('div', 'picker-tabs');
    for (const [key, label] of [['all', 'すべて'], ['todo', '未だけ'], ['done', '済だけ']]) {
      const b = btn(`picker-tab${state.filter === key ? ' active' : ''}`, label, () => { state.filter = key; render(); });
      b.dataset.filter = key;
      filters.append(b);
    }
    const sorts = el('div', 'picker-tabs');
    for (const [key, label] of [['near', `近い順(${origin.label})`], ['pref', '県ごと']]) {
      const b = btn(`picker-tab${state.sort === key ? ' active' : ''}`, label, () => { state.sort = key; render(); });
      b.dataset.sort = key;
      sorts.append(b);
    }

    // 県ごとの「済/全体」(絞り込みに関係なく、全体の数)
    const counts = el('div', 'picker-counts');
    for (const pref of prefOrder(stations)) {
      const inPref = stations.filter((s) => s.pref === pref);
      const done = inPref.filter((s) => visited.has(s.id)).length;
      const c = el('span', `picker-count${done === inPref.length ? ' complete' : ''}`, `${pref.replace(/[都府県]$/, '')} ${done} / ${inPref.length}`);
      c.dataset.pref = pref;
      counts.append(c);
    }

    let list = stations.map((s) => ({ s, d: distanceM(origin.lat, origin.lng, s.lat, s.lng), v: visited.get(s.id) }));
    if (state.filter === 'todo') list = list.filter((x) => !x.v);
    if (state.filter === 'done') list = list.filter((x) => x.v);
    const order = prefOrder(stations);
    list.sort(state.sort === 'near'
      ? (a, b) => a.d - b.d
      : (a, b) => order.indexOf(a.s.pref) - order.indexOf(b.s.pref) || a.s.name.localeCompare(b.s.name, 'ja'));

    const ul = el('ul', 'picker-list');
    let lastPref = null;
    for (const { s, d, v } of list) {
      if (state.sort === 'pref' && s.pref !== lastPref) {
        ul.append(el('li', 'picker-pref', s.pref));
        lastPref = s.pref;
      }
      const li = el('li', 'picker-item');
      li.dataset.id = s.id;
      li.dataset.state = v ? 'done' : 'todo';
      const mark = el('span', `picker-mark ${v ? 'visited' : 'unvisited'}`, '駅');
      const body = el('span', 'picker-body');
      body.append(el('span', 'picker-name', s.name), el('span', 'picker-sub', `${s.pref} ${s.city}`));
      const right = el('span', 'picker-right');
      right.append(el('span', 'picker-state', v ? `済${v.date ? ` ${fmtDay(v.date)}` : ''}` : '未'));
      if (state.sort === 'near') right.append(el('span', 'picker-dist', fmtDist(d)));
      li.append(mark, body, right);
      li.addEventListener('click', () => { close(); onPick(s); });
      ul.append(li);
    }
    if (list.length === 0) ul.append(el('li', 'picker-empty', '当てはまる駅はありません'));

    sheet.replaceChildren(head, filters, sorts, counts, ul);
  }

  function close() {
    sheet.hidden = true;
    sheet.replaceChildren();
    onClose?.();
  }

  render();
  sheet.hidden = false;
  return { close };
}
