// 道の駅のマーク(近畿・関東甲信。位置を確かめられた駅だけ)。
// - 自作のマーク(角の丸い四角に「駅」)。公式ロゴは登録商標なので使わない。食事の記録のピン(丸)と形・色で見分ける。
// - 行った駅=濃く塗りつぶし、行っていない駅=輪郭だけ。行った駅は、ほかのどのマークよりも上に出す。
// - 拡大7〜9は小さな点、拡大10以上でマーク。見ている範囲(少し外側まで)の駅だけ出す。
// - 「行った」は、(1) その人自身の写真つきの記録が駅から VISIT_RADIUS_M 以内にある、
//   または (2) 手で付けた「行った」がある、のどちらか(人ごと。他の人の記録では変わらない)。
// - 表示がオンの時は、地図の隅に道の駅の出典を足す(データは ODbL。data/README.md)。

const DATA_URL = 'data/michi-no-eki.json';
export const DOT_ZOOM = 7;         // これ以上で小さな点を出す(近畿・関東甲信が画面に入るくらい)
export const BADGE_ZOOM = 10;      // これ以上でマークを出す
export const VISIT_RADIUS_M = 300; // 記録がこの距離以内なら「行った」
const STORAGE_KEY = 'michiLayer';  // オン/オフの覚え(この端末だけ)

export const ATTRIBUTION =
  '道の駅: <a href="https://www.mlit.go.jp/road/Michi-no-Eki/list.html" target="_blank" rel="noopener">国土交通省「道の駅」一覧</a>を加工して作成(PDL1.0)・位置 '
  + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
  + '(<a href="data/README.md" target="_blank" rel="noopener">ODbL</a>)';

function readEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; } // 最初はオン
}

function writeEnabled(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
}

function googleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

const shortDate = (day) => {
  if (!day) return '';
  const [y, m, d] = day.slice(0, 10).split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
};

// 2点の距離(m)。数百mの判定なので、平面で近似して十分
export function distanceM(lat1, lng1, lat2, lng2) {
  const dy = (lat1 - lat2) * 111_320;
  const dx = (lng1 - lng2) * 111_320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// 駅の近く(VISIT_RADIUS_M 以内)にある記録を返す
export function recordsNear(station, records) {
  const degLat = VISIT_RADIUS_M / 111_320;
  const degLng = degLat / Math.cos(station.lat * Math.PI / 180);
  return records.filter((r) => Math.abs(r.lat - station.lat) <= degLat && Math.abs(r.lng - station.lng) <= degLng
    && distanceM(station.lat, station.lng, r.lat, r.lng) <= VISIT_RADIUS_M);
}

// 自分の記録と手で付けた「行った」から、行った駅を決める。id → { how, date }
export function visitedInfo(stations, ownRecords, manualVisits = []) {
  const info = new Map();
  for (const s of stations) {
    const near = recordsNear(s, ownRecords);
    if (near.length) {
      const first = near.map((r) => r.recordedAt).filter(Boolean).sort()[0] || null;
      info.set(s.id, { how: 'record', date: first ? first.slice(0, 10) : null });
    }
  }
  for (const v of manualVisits) {
    if (!info.has(v.stationId)) info.set(v.stationId, { how: 'manual', date: v.visitedOn || null, manual: true });
    else info.get(v.stationId).manual = true;
  }
  return info;
}

// buildExtra(station, info): 吹き出しの下に足す中身(駅のメモ・家族の記録・「行った」ボタンなど)を返す関数
export function createMichiLayer(map, { chip, counter, buildExtra = null }) {
  map.createPane('michi');
  map.getPane('michi').style.zIndex = 450;    // 行っていない駅: 食事の記録のピン(600)より下
  map.createPane('michiTop');
  map.getPane('michiTop').style.zIndex = 650; // 行った駅: いちばん上
  const renderers = { michi: L.svg({ pane: 'michi', padding: 0.3 }), michiTop: L.svg({ pane: 'michiTop', padding: 0.3 }) };
  const layer = L.layerGroup().addTo(map);
  const shown = new Map(); // id → { mode, visited, layers }
  let stations = [];
  let regions = {};
  let enabled = readEnabled();
  let ownRecords = [];
  let manualVisits = [];
  let visited = new Map();
  let showDetail = false;

  function buildPopup(s) {
    const box = document.createElement('div');
    box.className = 'michi-popup';
    const h = document.createElement('p');
    h.className = 'michi-name';
    h.textContent = `道の駅 ${s.name}`;
    const place = document.createElement('p');
    place.className = 'michi-place';
    place.textContent = `${s.pref} ${s.city}`;
    const v = visited.get(s.id);
    const state = document.createElement('p');
    state.className = v ? 'michi-state visited' : 'michi-state';
    state.textContent = !v ? 'まだ記録なし'
      : `✔ 行った(${v.how === 'record' ? 'あなたの記録から' : '手で付けた'}${v.date ? `・${shortDate(v.date)}` : ''})`;
    box.append(h, place);
    // OSMで「道の駅」の名前が付かない場所で決めた駅は、目で確かめるまで小さく断り書きを出す
    if (s.needsVisualCheck) {
      const verify = document.createElement('p');
      verify.className = 'michi-verify';
      verify.textContent = '位置は未確認(目視待ち)';
      box.append(verify);
    }
    box.append(state);
    if (buildExtra) {
      const extra = buildExtra(s, v || null);
      if (extra) box.append(extra);
    }
    const a = document.createElement('a');
    a.className = 'gmap-btn';
    a.textContent = 'Googleマップで開く';
    a.href = googleMapsUrl(s.lat, s.lng);
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a);
    return box;
  }

  function makeLayers(s, mode, isVisited) {
    const pane = isVisited ? 'michiTop' : 'michi';
    const popup = () => buildPopup(s);
    const popupOptions = { maxWidth: 260, autoPanPaddingTopLeft: L.point(64, 16) };
    if (mode === 'badge') {
      const icon = L.divIcon({
        className: '',
        html: `<div class="michi-badge ${isVisited ? 'visited' : 'unvisited'}" data-id="${s.id}"><span>駅</span></div>`,
        iconSize: [44, 44],   // 押せる範囲(見えるマークは34px)
        iconAnchor: [22, 22], // マークの真ん中が駅の位置
        popupAnchor: [0, -20],
      });
      return [L.marker([s.lat, s.lng], { icon, pane, keyboard: false }).bindPopup(popup, popupOptions)];
    }
    const dot = L.circleMarker([s.lat, s.lng], {
      pane, renderer: renderers[pane], radius: 6, weight: 2.5, color: '#be123c',
      fillColor: isVisited ? '#be123c' : '#ffffff', fillOpacity: 1, interactive: false,
      className: `michi-dot ${isVisited ? 'visited' : 'unvisited'}`,
    });
    // 手袋でも押せるよう、点より広い透明な範囲で押せるようにする
    const hit = L.circleMarker([s.lat, s.lng], {
      pane, renderer: renderers[pane], radius: 16, stroke: false, fillOpacity: 0, className: 'michi-hit',
    }).bindPopup(popup, popupOptions);
    return [dot, hit];
  }

  function updateCounter() {
    counter.hidden = !enabled || stations.length === 0;
    if (counter.hidden) return;
    const parts = Object.entries(regions).map(([name, prefs]) => {
      const inRegion = stations.filter((s) => prefs.includes(s.pref));
      return `${name} ${inRegion.filter((s) => visited.has(s.id)).length}/${inRegion.length}`;
    });
    const detail = showDetail ? `\n${parts.join('・')}` : '';
    counter.textContent = `道の駅 訪問 ${visited.size} / ${stations.length}${detail}`;
  }

  function update() {
    const zoom = map.getZoom();
    const mode = !enabled || zoom < DOT_ZOOM ? null : zoom >= BADGE_ZOOM ? 'badge' : 'dot';
    chip.textContent = !enabled ? '道の駅 オフ' : mode ? '道の駅' : '道の駅(拡大で表示)';
    chip.classList.toggle('on', enabled);
    chip.setAttribute('aria-pressed', String(enabled));
    updateCounter();
    if (!mode) {
      layer.clearLayers();
      shown.clear();
      return;
    }
    const area = map.getBounds().pad(0.2);
    const want = new Set();
    for (const s of stations) {
      if (!area.contains([s.lat, s.lng])) continue;
      want.add(s.id);
      const isVisited = visited.has(s.id);
      const cur = shown.get(s.id);
      if (cur && cur.mode === mode && cur.visited === isVisited) continue;
      if (cur) cur.layers.forEach((l) => layer.removeLayer(l));
      const layers = makeLayers(s, mode, isVisited);
      layers.forEach((l) => l.addTo(layer));
      shown.set(s.id, { mode, visited: isVisited, layers });
    }
    for (const [id, cur] of shown) {
      if (!want.has(id)) {
        cur.layers.forEach((l) => layer.removeLayer(l));
        shown.delete(id);
      }
    }
  }

  function setEnabled(on) {
    enabled = on;
    writeEnabled(on);
    if (on) map.attributionControl.addAttribution(ATTRIBUTION);
    else map.attributionControl.removeAttribution(ATTRIBUTION);
    update();
  }

  function recompute() {
    visited = visitedInfo(stations, ownRecords, manualVisits);
    update();
  }

  chip.addEventListener('click', () => setEnabled(!enabled));
  counter.addEventListener('click', () => { showDetail = !showDetail; updateCounter(); });
  map.on('moveend zoomend', update);

  const ready = fetch(DATA_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`道の駅のデータを読めませんでした(${res.status})`))))
    .then((data) => {
      stations = data.stations;
      regions = data.meta.regions || {};
      chip.hidden = false;
      setEnabled(enabled);
      recompute();
      return stations.length;
    })
    .catch(() => {
      chip.hidden = true; // データがなければ切り替えも出さない(記録の機能には影響しない)
      counter.hidden = true;
      return 0;
    });

  return {
    ready,
    // 自分の記録(写真つき)を渡すと「行った」を決め直す。他の人の記録は渡さない
    setOwnRecords(records) {
      ownRecords = records.map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.recordedAt || null }));
      recompute();
    },
    // 手で付けた「行った」(本人の分)
    setManualVisits(list) {
      manualVisits = list.map((v) => ({ stationId: v.stationId, visitedOn: v.visitedOn || null }));
      recompute();
    },
    // 開いている吹き出しを作り直す(駅のメモが変わった時など)
    refreshPopups() {
      for (const [id, cur] of shown) {
        for (const l of cur.layers) {
          if (l.isPopupOpen?.()) l.setPopupContent(buildPopup(stations.find((s) => s.id === id)));
        }
      }
      update();
    },
    stations: () => stations,
    // 画面上で、地図の点から px 画素以内にある駅のうち、いちばん近い駅
    nearestWithinPx(latlng, px) {
      const p = map.latLngToContainerPoint(latlng);
      let best = null;
      for (const s of stations) {
        const d = p.distanceTo(map.latLngToContainerPoint([s.lat, s.lng]));
        if (d <= px && (!best || d < best.d)) best = { s, d };
      }
      return best ? best.s : null;
    },
    visitedMap: () => new Map(visited),
    shownIds: () => [...shown.keys()],
    shownMode: () => [...shown.values()][0]?.mode ?? null,
    visitedIds: () => [...visited.keys()],
    isEnabled: () => enabled,
  };
}
