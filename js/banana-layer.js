// 「せっかくグルメ」登場店(🍌)の候補を地図に出す。
// - データは data/banana-shops.json(ジェミが作った候補リストに、確認の状態を機械で付けた物。番組の文章・写真は含まない)
// - 黄色い丸に🍌(絵文字が出ない端末では「バ」)。道の駅の赤い四角・記録の先のとがったピンと、形と色で見分ける
// - 確認済み=はっきり、番組のページあり・未確認=少しうすく、破線の縁
// - 拡大7以上で、見ている範囲だけ出す。拡大12以下は近い店を数字つきで束ねる(記録ピンのまとめマークと同じ仕組み)
// - 重なりの順: 行った駅(650) > 記録ピン(600) > 🍌(520) > 行っていない駅(450)

const DATA_URL = 'data/banana-shops.json';
export const SHOW_ZOOM = 7;
const CLUSTER_UNTIL_ZOOM = 13;
const CELL_PX = 56;
const STORAGE_KEY = 'bananaLayer';
export const ATTRIBUTION = '🍌: 番組紹介店の候補リスト(確認の状態つき)';

const STATUS_TEXT = {
  verified: '確認済み',
  program_page: '番組のページで確認してください',
  unconfirmed: '未確認',
};

function readEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; } // 最初はオン
}

function writeEnabled(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
}

// 色つきの絵文字が出る端末か(出なければ「バ」を使う)
let symbolCache = null;
export function bananaSymbol() {
  if (symbolCache) return symbolCache;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.font = '24px sans-serif';
    g.textBaseline = 'top';
    g.fillText('🍌', 2, 2);
    const d = g.getImageData(0, 0, 32, 32).data;
    let colored = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) { colored = true; break; }
    }
    symbolCache = colored ? '🍌' : 'バ';
  } catch {
    symbolCache = 'バ';
  }
  return symbolCache;
}

function fmtDate(day) {
  const [y, m, d] = day.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

// Googleマップは「店名+住所」で探す形で渡す(候補リストの座標は使わない)
export function googleMapsUrl(shop) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${shop.address}`)}`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function link(cls, text, href) {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

export function buildBananaPopup(shop) {
  const box = el('div', 'banana-popup');
  box.dataset.id = shop.id;
  box.append(el('p', 'banana-name', `🍌 ${shop.name}`));
  box.append(el('p', 'banana-menu', [shop.genre, shop.menu].filter(Boolean).join(' / ')));
  const showDate = shop.status !== 'unconfirmed' && shop.airedOn;
  box.append(el('p', 'banana-aired', showDate ? `放送日: ${fmtDate(shop.airedOn)}` : '放送日は未確認'));
  box.append(el('p', `banana-status ${shop.status}`, STATUS_TEXT[shop.status]));
  if (shop.approxPosition) box.append(el('p', 'banana-note', '位置はおおよそです'));
  box.append(el('p', 'banana-note', '※最新の営業情報はGoogleマップで確認してください'));
  if (shop.status !== 'unconfirmed') box.append(link('banana-source', '番組のページ', shop.sourceUrl));
  box.append(link('gmap-btn', 'Googleマップで開く', googleMapsUrl(shop)));
  return box;
}

export function createBananaLayer(map, { chip }) {
  map.createPane('banana');
  map.getPane('banana').style.zIndex = 520;
  const layer = L.layerGroup().addTo(map);
  let shops = [];
  let enabled = readEnabled();
  let shownIds = [];
  let clusterCount = 0;

  function icon(shop) {
    return L.divIcon({
      className: '',
      html: `<div class="banana-mark ${shop.status}" data-id="${shop.id}"><span>${bananaSymbol()}</span></div>`,
      iconSize: [44, 44],   // 押せる範囲(見えるマークは34px)
      iconAnchor: [22, 22],
      popupAnchor: [0, -18],
    });
  }

  function clusterIcon(n) {
    return L.divIcon({
      className: '',
      html: `<div class="banana-cluster"><span>${bananaSymbol()}${n}</span></div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
  }

  let lastSignature = '';
  const singles = new Map(); // 店の番号 → 1つで出しているマーク(吹き出しを開き直すため)

  function update() {
    const zoom = map.getZoom();
    chip.classList.toggle('on', enabled);
    chip.setAttribute('aria-pressed', String(enabled));
    chip.textContent = enabled ? '🍌' : '🍌 オフ';
    const groups = new Map();
    if (enabled && zoom >= SHOW_ZOOM) {
      const area = map.getBounds().pad(0.2);
      for (const s of shops.filter((x) => area.contains([x.lat, x.lng]))) {
        const key = zoom >= CLUSTER_UNTIL_ZOOM ? s.id : (() => {
          const p = map.project([s.lat, s.lng], zoom);
          return `${Math.floor(p.x / CELL_PX)}:${Math.floor(p.y / CELL_PX)}`;
        })();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
    }
    // 出す物が前と同じなら作り直さない(吹き出しを開いた時の地図の小さな移動で、吹き出しが閉じないように)
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
      if (g.length === 1) {
        const s = g[0];
        const m = L.marker([s.lat, s.lng], { icon: icon(s), pane: 'banana', keyboard: false })
          .bindPopup(() => buildBananaPopup(s), { maxWidth: 260, autoPanPaddingTopLeft: L.point(64, 16) })
          .addTo(layer);
        singles.set(s.id, m);
      } else {
        clusterCount++;
        const b = L.latLngBounds(g.map((s) => [s.lat, s.lng]));
        L.marker(b.getCenter(), { icon: clusterIcon(g.length), pane: 'banana', title: `🍌 ${g.length}店` })
          .on('click', () => {
            const target = Math.max(map.getBoundsZoom(b, false, L.point(80, 80)), zoom + 2);
            map.setView(b.getCenter(), Math.min(target, CLUSTER_UNTIL_ZOOM));
          })
          .addTo(layer);
      }
    }
    if (openId && singles.has(openId)) singles.get(openId).openPopup();
  }

  function setEnabled(on) {
    enabled = on;
    writeEnabled(on);
    if (on) map.attributionControl.addAttribution(ATTRIBUTION);
    else map.attributionControl.removeAttribution(ATTRIBUTION);
    update();
  }

  chip.addEventListener('click', () => setEnabled(!enabled));
  map.on('moveend zoomend', update);

  const ready = fetch(DATA_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`🍌のデータを読めませんでした(${res.status})`))))
    .then((data) => {
      shops = data.shops;
      chip.hidden = false;
      setEnabled(enabled);
      return shops.length;
    })
    .catch(() => {
      chip.hidden = true;
      return 0;
    });

  return {
    ready,
    shops: () => shops,
    shownIds: () => [...shownIds],
    clusterCount: () => clusterCount,
    isEnabled: () => enabled,
  };
}
