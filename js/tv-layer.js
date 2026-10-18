// テレビ番組の候補店(せっかくグルメ・孤独のグルメ・オモウマい店)を地図に出す。
// - データは data/tv-shops.json(data-src/build_tv.py で1回だけ位置を調べて保存した結果。起動のたびには検索しない)
// - 形は「ひし形」。🍌の公式候補(黄色い丸)・行きたい店(しおり型)・道の駅(四角)と見分ける。うすい+破線=未確認、点線=位置がおおよそ
// - 番組ごとの切り替え: せっかくグルメは既存の🍌ボタンと同じ切り替え(最初オン)、孤独のグルメ・オモウマい店は最初オフ。端末に覚える
// - 拡大7以上で、見ている範囲だけ出す。拡大12以下は近い店を番組ごとに数字つきで束ねる(🍌と同じ仕組み)
// - 🍌の既存の店と同じ店(duplicateOf)は出さない(既存を優先)
// - 重なりの順: 行きたい(540) > 🍌(520) > テレビ候補(515) > 行っていない駅(450)
import { PROGRAMS, ACCURACY_TEXT, isApprox, hasLatLng } from './tv-programs.js';
import { bananaSymbol } from './banana-layer.js';

const DATA_URL = 'data/tv-shops.json';
export const SHOW_ZOOM = 7;
const CLUSTER_UNTIL_ZOOM = 13;
const CELL_PX = 56;
const STORAGE_PREFIX = 'tvLayer.';
export const ATTRIBUTION = 'テレビ候補店の位置: 国土地理院・© OpenStreetMap contributors(おおよそ)';

function readOn(p) {
  if (p.sharedChip) {
    try { return localStorage.getItem('bananaLayer') !== 'off'; } catch { return p.defaultOn; }
  }
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + p.key);
    return v == null ? p.defaultOn : v === 'on';
  } catch { return p.defaultOn; }
}
function writeOn(p, on) {
  if (p.sharedChip) return; // 🍌のボタンが自分で覚える
  try { localStorage.setItem(STORAGE_PREFIX + p.key, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
}

// 色つきの絵文字が出る端末か(出なければ漢字1字)
const symbolCache = new Map();
export function symbolOf(p) {
  if (p.key === 'sk') return bananaSymbol() === '🍌' ? '🍌' : p.fallbackSymbol;
  if (symbolCache.has(p.key)) return symbolCache.get(p.key);
  let out = p.fallbackSymbol;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.font = '24px sans-serif';
    g.textBaseline = 'top';
    g.fillText(p.symbol, 2, 2);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) { out = p.symbol; break; }
    }
  } catch { /* 漢字のまま */ }
  symbolCache.set(p.key, out);
  return out;
}

function fmtDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : '';
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const link = (cls, text, href) => {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};
const coord = (x) => String(Number(Number(x).toFixed(6)));

// Googleマップ: 店名で一致した位置は緯度経度、おおよそ・位置なしの店は「店名+市区町村」で探す
const nameQuery = (s) => encodeURIComponent(`${s.name} ${s.pref || ''}${s.city || ''}`.trim());
export function tvMapsViewUrl(s) {
  if (hasLatLng(s) && !isApprox(s)) return `https://www.google.com/maps/search/?api=1&query=${coord(s.lat)},${coord(s.lng)}`;
  return `https://www.google.com/maps/search/?api=1&query=${nameQuery(s)}`;
}
export function tvMapsDirUrl(s) {
  const dest = hasLatLng(s) && !isApprox(s) ? `${coord(s.lat)},${coord(s.lng)}` : nameQuery(s);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

// 吹き出し。onAdd(shop) は「行きたいに入れる」を押した時に呼ぶ(結果 { ok, message } を返す)
export function buildTvPopup(shop, program, { onAdd } = {}) {
  const box = el('div', 'tv-popup');
  box.dataset.id = shop.id;
  box.dataset.program = program.key;
  const top = el('div', 'popup-topbar');
  const close = el('button', 'popup-top-btn tv-close-top', '閉じる');
  close.type = 'button';
  close.addEventListener('click', () => document.getElementById('map') && window.appMap?.closePopup());
  top.append(close);
  box.append(top);
  box.append(el('p', 'tv-name', `${symbolOf(program)} ${shop.name}`));
  box.append(el('p', 'tv-meta', [program.label, fmtDate(shop.airedOn) ? `放送日: ${fmtDate(shop.airedOn)}` : '放送日は未確認'].join(' / ')));
  box.append(el('p', 'tv-meta', [shop.genre, [shop.pref, shop.city].filter(Boolean).join('')].filter(Boolean).join(' / ')));
  box.append(el('p', 'tv-status', '候補(未確認)'));
  if (shop.note) box.append(el('p', 'tv-note', `注意: ${shop.note}`));
  if (isApprox(shop)) {
    box.append(el('p', 'tv-approx', hasLatLng(shop) ? `位置はおおよそです(${ACCURACY_TEXT[shop.accuracy] || ''})` : '位置はおおよそです(地図には出ていません。店名で探せます)'));
  }
  if (program.caution) box.append(el('p', 'tv-caution', program.caution));
  box.append(el('p', 'tv-hint', '※最新の営業情報はGoogleマップで確認してください'));
  if (/^https?:\/\//.test(shop.sourceUrl || '')) box.append(link('tv-source', '出典のページ(別のタブで開く)', shop.sourceUrl));
  const links = el('div', 'wish-gmap-links');
  links.append(link('gmap-btn', isApprox(shop) ? 'Googleマップで探す' : 'Googleマップで見る', tvMapsViewUrl(shop)));
  links.append(link('gmap-dir', 'ここへ行く(Googleマップで案内)', tvMapsDirUrl(shop)));
  box.append(links);
  if (onAdd) {
    const add = el('button', 'btn main wide tv-add', '行きたいに入れる');
    add.type = 'button';
    const msg = el('p', 'tv-add-msg');
    msg.setAttribute('role', 'status');
    add.addEventListener('click', async () => {
      add.disabled = true;
      let r;
      try { r = await onAdd(shop); } catch (e) { r = { ok: false, message: e.message || 'うまく入れられませんでした' }; }
      msg.textContent = r.message || '';
      msg.classList.toggle('error', !r.ok);
      if (r.ok) add.textContent = '入れました ✓'; else add.disabled = false;
    });
    box.append(add, msg);
  }
  return box;
}

export function createTvLayer(map, { chips, bananaChip, onAdd }) {
  map.createPane('tv');
  map.getPane('tv').style.zIndex = 515;
  const layer = L.layerGroup().addTo(map);
  let shops = [];
  const on = new Map(PROGRAMS.map((p) => [p.key, readOn(p)]));
  const singles = new Map();
  let shownIds = [];
  let clusterCount = 0;
  let lastSignature = '';
  let attributed = false;

  const progOf = (s) => PROGRAMS.find((p) => p.label === s.program) || null;

  function icon(s, p) {
    const cls = ['tv-mark', p.key, isApprox(s) ? 'approx' : ''].filter(Boolean).join(' ');
    return L.divIcon({
      className: '',
      html: `<div class="${cls}" data-id="${s.id}" style="--tv-bg:${p.color};--tv-edge:${p.edge};--tv-ink:${p.ink}"><span>${symbolOf(p)}</span></div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
      popupAnchor: [0, -18],
    });
  }
  function clusterIcon(n, p) {
    return L.divIcon({
      className: '',
      html: `<div class="tv-cluster ${p.key}" style="--tv-bg:${p.color};--tv-edge:${p.edge};--tv-ink:${p.ink}"><span>${symbolOf(p)}${n}</span></div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
  }

  function paintChips() {
    for (const p of PROGRAMS) {
      const chip = chips[p.key];
      if (!chip || p.sharedChip) continue;
      chip.classList.toggle('on', on.get(p.key));
      chip.setAttribute('aria-pressed', String(on.get(p.key)));
      chip.textContent = on.get(p.key) ? p.symbol : `${p.symbol} オフ`;
    }
  }

  function syncShared() {
    for (const p of PROGRAMS) if (p.sharedChip) on.set(p.key, window.bananaLayer?.isEnabled?.() ?? readOn(p));
  }

  function update() {
    syncShared();
    paintChips();
    const anyOn = [...on.values()].some(Boolean);
    if (anyOn !== attributed) {
      attributed = anyOn;
      if (anyOn) map.attributionControl.addAttribution(ATTRIBUTION); else map.attributionControl.removeAttribution(ATTRIBUTION);
    }
    const zoom = map.getZoom();
    const groups = new Map();
    if (zoom >= SHOW_ZOOM) {
      const area = map.getBounds().pad(0.2);
      for (const s of shops) {
        const p = progOf(s);
        if (!p || !on.get(p.key) || s.duplicateOf || !hasLatLng(s) || !area.contains([s.lat, s.lng])) continue;
        const key = zoom >= CLUSTER_UNTIL_ZOOM ? s.id : (() => {
          const pt = map.project([s.lat, s.lng], zoom);
          return `${p.key}:${Math.floor(pt.x / CELL_PX)}:${Math.floor(pt.y / CELL_PX)}`;
        })();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
    }
    const signature = `${zoom}|${[...groups.entries()].map(([k, g]) => `${k}:${g.map((s) => s.id).join(',')}`).sort().join(';')}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    const openId = [...singles].find(([, m]) => m.isPopupOpen())?.[0];
    layer.clearLayers();
    singles.clear();
    shownIds = [];
    clusterCount = 0;
    for (const g of groups.values()) {
      shownIds.push(...g.map((s) => s.id));
      const p = progOf(g[0]);
      if (g.length === 1) {
        const s = g[0];
        const m = L.marker([s.lat, s.lng], { icon: icon(s, p), pane: 'tv', keyboard: false })
          .bindPopup(() => buildTvPopup(s, p, { onAdd }), { maxWidth: 270 })
          .addTo(layer);
        singles.set(s.id, m);
      } else {
        clusterCount++;
        const b = L.latLngBounds(g.map((s) => [s.lat, s.lng]));
        L.marker(b.getCenter(), { icon: clusterIcon(g.length, p), pane: 'tv', title: `${p.symbol} ${g.length}店(テレビ候補)` })
          .on('click', () => {
            const target = Math.max(map.getBoundsZoom(b, false, L.point(80, 80)), zoom + 2);
            map.setView(b.getCenter(), Math.min(target, CLUSTER_UNTIL_ZOOM));
          })
          .addTo(layer);
      }
    }
    if (openId && singles.has(openId)) singles.get(openId).openPopup();
  }

  function setOn(key, value) {
    const p = PROGRAMS.find((x) => x.key === key);
    if (!p || p.sharedChip) return;
    on.set(key, value);
    writeOn(p, value);
    update();
  }

  for (const p of PROGRAMS) {
    if (p.sharedChip) continue;
    chips[p.key]?.addEventListener('click', () => setOn(p.key, !on.get(p.key)));
  }
  // 🍌のボタンは、🍌自身が先に状態を替える(あとから呼ばれるよう、あとで足した聞き手で読み直す)
  bananaChip?.addEventListener('click', () => update());
  map.on('moveend zoomend', update);

  const ready = fetch(DATA_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`テレビ候補のデータを読めませんでした(${res.status})`))))
    .then((data) => {
      shops = data.shops || [];
      for (const p of PROGRAMS) if (chips[p.key]) chips[p.key].hidden = false;
      update();
      return shops.length;
    })
    .catch(() => {
      for (const p of PROGRAMS) if (chips[p.key]) chips[p.key].hidden = true;
      return 0;
    });

  return {
    ready,
    shops: () => shops,
    shownIds: () => [...shownIds],
    clusterCount: () => clusterCount,
    isOn: (key) => !!on.get(key),
    setOn,
    refresh: update,
    openPopup: (id) => singles.get(id)?.openPopup(),
    // 試験用: 候補店を差し替える(位置なしの店・数が多い時の表示を確かめるため)
    setShopsForTest: (list) => { shops = list; lastSignature = ''; update(); },
  };
}
