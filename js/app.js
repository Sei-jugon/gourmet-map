import * as store from './store.js';
import { shrinkPhoto } from './photo.js';
import { getPositionOnce } from './location.js';
import { buildSteps } from './permission-help.js';
import { createMichiLayer, recordsNear } from './michi-layer.js';
import { openStationPicker } from './station-picker.js';
import { openStationEditor } from './station-editor.js';

const JAPAN_CENTER = [36.2, 138.25];
const $ = (id) => document.getElementById(id);

let me = null; // ログインしている家族(ログイン後に決まる)
const params = new URLSearchParams(location.search);
// 試験の時(アドレスに ?trial=1): 作る記録のメモに「試験」を必ず入れてもらう(後で消せるように)
const trialMode = params.get('trial') === '1';

// ===== 地図 =====

const map = L.map('map', { zoomControl: true }).setView(JAPAN_CENTER, 6);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// 上の帯(試験中・圏外)が出たり消えたりして地図の表示部分の大きさが変わったら、地図に知らせる。
// 知らせないと、地図が覚えている大きさと実際がずれ、真ん中の位置が下にずれる
new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(map.getContainer());

const pinLayer = L.layerGroup().addTo(map);

// 道の駅のマーク(試験から状態を見られるよう window に置く)
window.michiLayer = createMichiLayer(map, {
  chip: $('michi-chip'),
  counter: $('michi-counter'),
  buildExtra: (station, visit) => buildStationExtra(station, visit),
});
window.appMap = map;

// 地図の隅の出典が下のボタンに隠れないよう、出典の高さの分だけボタンを上げる
const attributionEl = map.attributionControl.getContainer();
const placeAboveAttribution = () => {
  document.documentElement.style.setProperty('--attr-h', `${attributionEl.offsetHeight}px`);
};
new ResizeObserver(placeAboveAttribution).observe(attributionEl);
placeAboveAttribution();
const markersById = new Map();
let firstRender = true;

// 食事の記録のピン: 丸(40px)の下にとがった先(10px)。先の先端が記録の位置(基準点)
const PIN_W = 40;
const PIN_H = 50;
function pinIcon(pin) {
  const classes = ['pin-icon', pin.recorder];
  if (!pin.shared) classes.push('private');
  if (pin.pending) classes.push('pending');
  const symbol = pin.pending ? '⏳' : pin.shared ? '🍴' : '🔒';
  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="${classes.join(' ')}" data-id="${pin.id}"><span>${symbol}</span></div>`,
    iconSize: [PIN_W, PIN_H],
    iconAnchor: [PIN_W / 2, PIN_H],   // とがった先の先端
    popupAnchor: [0, -PIN_H + 4],
  });
}

// 縮小した地図で近くの記録ピンをまとめるマーク(数字つき)。押すと、その範囲に拡大してばらける
const CLUSTER_UNTIL_ZOOM = 13; // これより引いた地図でまとめる
const CLUSTER_CELL_PX = 56;    // 画面上でこの大きさのます目に入ったピンを1つにまとめる
// 試験用: アドレスに ?nocluster=1 を付けると、まとめずに全部のピンを出す(1つずつ押す試験のため)
const clusterOff = new URLSearchParams(location.search).get('nocluster') === '1';
function clusterIcon(count) {
  return L.divIcon({
    className: '',
    html: `<div class="pin-cluster"><span>${count}</span></div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

// ===== 小さな部品 =====

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function starsText(stars) {
  if (!stars) return '';
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 本家のGoogleマップに場所を渡す(画面には埋め込まない)
function googleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

let toastTimer;
function showToast(message, ms = 3500) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, ms);
}

// 星の入力: 同じ星をもう一度押すと消える
function starsInput(container) {
  let value = null;
  const buttons = [1, 2, 3, 4, 5].map((n) => button('star', '☆', () => set(value === n ? null : n)));
  container.replaceChildren(...buttons);
  function set(v) {
    value = v;
    buttons.forEach((b, i) => {
      b.textContent = value && i < value ? '★' : '☆';
      b.setAttribute('aria-label', `星${i + 1}`);
    });
  }
  set(null);
  return { get: () => value, set };
}

const recordStars = starsInput($('record-stars'));
const noteStars = starsInput($('note-stars'));

// ===== 吹き出し =====

// 写真は吹き出しを開くたびに読み直す(「見せない」に変わった写真を出さないため)。
// 一時的なアドレス(blob:)は、吹き出しを閉じた時に解放する
function releasePhoto(popupEl) {
  const img = popupEl?.querySelector('.pin-popup img');
  if (img?.src.startsWith('blob:')) {
    if ($('photo-viewer-img').src === img.src) closePhotoViewer();
    URL.revokeObjectURL(img.src);
    img.removeAttribute('src');
  }
}

async function loadPhoto(pin, img, note) {
  try {
    const url = await store.photoUrl(pin);
    if (!img.isConnected) { // 読み込み中に吹き出しが閉じられた
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }
    img.src = url;
    img.hidden = false;
    note.hidden = true;
  } catch (e) {
    note.textContent = e.message.includes('電波') ? '写真は電波が戻ると表示されます' : e.message;
  }
}

function buildPopup(pin) {
  const box = el('div', 'pin-popup');

  const img = el('img');
  img.alt = pin.memo || '記録した写真';
  img.hidden = true;
  img.addEventListener('click', () => openPhoto(img.src));
  const note = el('div', 'photo-note', '写真を読み込み中…');
  box.append(img, note);
  loadPhoto(pin, img, note);

  const meta = el('p', 'meta');
  meta.append(el('span', `recorder ${pin.recorder}`, `${pin.recorderName}の記録`));
  meta.append(` ・ ${formatDate(pin.recordedAt)}`);
  box.append(meta);

  if (pin.pending) {
    box.append(el('p', pin.failed ? 'status failed' : 'status pending',
      pin.failed ? `送れませんでした: ${pin.failed}` : '⏳ 未送信(電波が戻ると送ります)'));
  }

  if (pin.stars) box.append(el('div', 'stars', starsText(pin.stars)));
  if (pin.memo) box.append(el('p', 'memo', pin.memo));

  for (const r of pin.reactions) {
    const parts = [`${r.by}:`];
    if (r.stars) parts.push(starsText(r.stars));
    if (r.memo) parts.push(r.memo);
    if (r.pending) parts.push('(未送信)');
    box.append(el('p', 'reactions', parts.join(' ')));
  }

  if (pin.mine) {
    box.append(buildShareToggle(pin));
    box.append(button('btn sub wide', 'メモ・星を直す', () => openNoteSheet(pin, 'edit')));
  } else {
    box.append(button('btn sub wide', '一言・星をつける', () => openNoteSheet(pin, 'reaction')));
  }

  const gmap = el('a', 'gmap-btn', 'Googleマップで開く');
  gmap.href = googleMapsUrl(pin.lat, pin.lng);
  gmap.target = '_blank';
  gmap.rel = 'noopener';
  box.append(gmap);

  return box;
}

// 自分の記録だけに出る「家族に見せる/見せない」の切り替え
function buildShareToggle(pin) {
  const wrap = el('div', 'share-row');
  wrap.append(el('span', 'share-state', pin.shared ? '家族に見せています' : '🔒 自分だけ(家族には見えません)'));
  wrap.append(button('share-btn', pin.shared ? '見せないにする' : '家族に見せる', async (e) => {
    e.currentTarget.disabled = true;
    await store.setShared(pin.id, !pin.shared);
    showToast(!pin.shared
      ? '家族に見せるようにしました'
      : '自分だけに戻しました。すでに家族のスマホに表示された写真は、取り戻せません', 5000);
  }));
  return wrap;
}

// ===== 道の駅の吹き出しに足す中身 =====
// 駅のメモ(グルメトップ3・地元の一押し・TVで紹介)は、データがなければ何も出さない。
// 「家族が駅の近くで食べた物」は、本人に見えている記録(自分+家族が見せている物)から計算で出す。

let stationData = { notes: [], gourmet: [], tv: [] };
let stationEditor = false;

async function loadStationInfo() {
  try {
    stationData = await store.loadStationData();
    stationEditor = await store.isStationEditor();
  } catch { /* 表がまだない時など。何も出さない */ }
}

function linkTo(url, text) {
  const a = el('a', 'note-link', text);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function buildStationExtra(station, visit) {
  const box = el('div', 'station-extra');
  const gourmet = stationData.gourmet.filter((g) => g.stationId === station.id);
  const note = stationData.notes.find((n) => n.stationId === station.id);
  const tv = stationData.tv.filter((t) => t.stationId === station.id);

  if (gourmet.length) {
    const sec = el('div', 'note-sec gourmet');
    sec.append(el('p', 'note-title', 'グルメトップ3'));
    for (const g of gourmet) {
      const p = el('p', 'note-line');
      p.append(`${g.rank}. ${g.dish}(${g.shop}) `, linkTo(g.sourceUrl, `確認 ${g.confirmedOn}`));
      sec.append(p);
    }
    box.append(sec);
  }
  if (note?.localPick) {
    const sec = el('div', 'note-sec local');
    sec.append(el('p', 'note-title', '地元の一押し'), el('p', 'note-line', `「${note.localPick}」(${note.localPickFrom}・${note.localPickOn})`));
    box.append(sec);
  }
  if (tv.length) {
    const sec = el('div', 'note-sec tv');
    sec.append(el('p', 'note-title', 'TVで紹介'));
    for (const t of tv) {
      const p = el('p', 'note-line');
      p.append(`${t.program}(${t.airedOn})${t.note ? ` ${t.note}` : ''} `, linkTo(t.sourceUrl, '出典'));
      sec.append(p);
    }
    box.append(sec);
  }

  // 家族が駅の近くで食べた物と星(本人に見えている記録だけ)
  const near = recordsNear(station, currentPins).filter((p) => p.memo || p.stars)
    .sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || '')).slice(0, 5);
  if (near.length) {
    const sec = el('div', 'note-sec family');
    sec.append(el('p', 'note-title', '家族が近くで食べた物'));
    for (const p of near) {
      sec.append(el('p', 'note-line', `${p.recorderName}${p.stars ? ` ${starsText(p.stars)}` : ''}${p.memo ? ` ${p.memo}` : ''}`));
    }
    box.append(sec);
  }

  // 手で付ける「行った」(昔の分)。記録で「行った」になっている駅には出さない
  if (!visit) {
    box.append(button('btn sub wide visit-add', '行った(手で付ける)', () => openVisitModal(station)));
  } else if (visit.how === 'manual') {
    box.append(button('btn sub wide visit-remove', '手で付けた「行った」を外す', async () => {
      map.closePopup();
      await store.removeManualVisit(station.id);
      showToast(`道の駅 ${station.name} の「行った」を外しました`);
    }));
  }

  if (stationEditor) {
    box.append(button('btn sub wide station-edit', '駅のメモを書く(駅メモ係)', () => {
      map.closePopup();
      openStationEditor($('station-editor'), {
        station,
        data: { note, gourmet, tv },
        onSave: async (payload) => {
          await store.saveStationMemo(payload);
          await loadStationInfo();
          showToast('駅のメモを保存しました');
        },
      });
    }));
  }
  return box.childElementCount ? box : null;
}

let visitStation = null;
function openVisitModal(station) {
  visitStation = station;
  map.closePopup();
  $('visit-title').textContent = `道の駅 ${station.name} に行った`;
  $('visit-date').value = '';
  $('visit-date').max = store.todayKey();
  $('visit-modal').hidden = false;
}
$('visit-cancel').addEventListener('click', () => { $('visit-modal').hidden = true; });
$('visit-ok').addEventListener('click', async () => {
  const day = $('visit-date').value || null;
  if (day && day > store.todayKey()) {
    showToast('行った日に未来の日は使えません');
    return;
  }
  $('visit-modal').hidden = true;
  await store.addManualVisit(visitStation.id, day);
  showToast(`道の駅 ${visitStation.name} を「行った」にしました`);
});

function openPhoto(url) {
  $('photo-viewer-img').src = url;
  $('photo-viewer').hidden = false;
}

function closePhotoViewer() {
  $('photo-viewer').hidden = true;
  $('photo-viewer-img').removeAttribute('src');
}

$('photo-viewer-close').addEventListener('click', closePhotoViewer);

// ===== 表示の更新 =====

async function render() {
  if (!me) return; // ログイン前は何も出さない
  const openId = [...markersById].find(([, m]) => m.isPopupOpen())?.[0];
  const { pins, offline } = await store.loadPins();
  // 道の駅の「行った」: 自分の写真つきの記録だけで決める(見せない記録も含む。他の人の記録は使わない)
  window.michiLayer.setOwnRecords(pins.filter((p) => p.mine && (p.photoPath || p.localPhoto)));

  currentPins = pins;
  try { window.michiLayer.setManualVisits(await store.loadManualVisits()); } catch { /* 表がまだない時など。自動の「行った」だけで続ける */ }

  if (firstRender && pins.length > 0) {
    map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng])), { padding: [48, 48], maxZoom: 15 });
  }
  firstRender = false;
  drawPins(openId);

  $('offline-bar').hidden = !offline;
  await renderStatus();
}

// 記録ピンを地図に置く。縮小時は、画面上で近いピンを数字つきのまとめマークにする
let currentPins = [];
function drawPins(openId = null) {
  for (const m of markersById.values()) if (m.isPopupOpen()) releasePhoto(m.getPopup().getElement());
  pinLayer.clearLayers();
  markersById.clear();
  const zoom = map.getZoom();
  const groups = new Map();
  for (const pin of currentPins) {
    const key = zoom >= CLUSTER_UNTIL_ZOOM || clusterOff ? pin.id : (() => {
      const p = map.project([pin.lat, pin.lng], zoom);
      return `${Math.floor(p.x / CLUSTER_CELL_PX)}:${Math.floor(p.y / CLUSTER_CELL_PX)}`;
    })();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pin);
  }
  for (const group of groups.values()) {
    if (group.length === 1) {
      const pin = group[0];
      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(pin) })
        .bindPopup(() => buildPopup(pin), { maxWidth: 264, autoPanPaddingTopLeft: L.point(64, 16) })
        .on('popupclose', (e) => releasePhoto(e.popup.getElement()))
        .addTo(pinLayer);
      markersById.set(pin.id, marker);
    } else {
      const bounds = L.latLngBounds(group.map((p) => [p.lat, p.lng]));
      L.marker(bounds.getCenter(), { icon: clusterIcon(group.length), title: `記録 ${group.length}件` })
        .on('click', () => {
          const target = Math.max(map.getBoundsZoom(bounds, false, L.point(80, 80)), zoom + 2);
          map.setView(bounds.getCenter(), Math.min(target, CLUSTER_UNTIL_ZOOM));
        })
        .addTo(pinLayer);
    }
  }
  if (openId && markersById.has(openId)) markersById.get(openId).openPopup();
}
map.on('zoomend', () => drawPins());

async function renderStatus() {
  const { pending, failed } = await store.outboxStatus();
  const badge = $('outbox-badge');
  if (failed.length > 0) {
    badge.textContent = `送れない ${failed.length}件`;
    badge.className = 'chip error';
  } else {
    badge.textContent = `未送信 ${pending}件`;
    badge.className = 'chip warn';
  }
  badge.hidden = pending === 0 && failed.length === 0;
}

$('outbox-badge').addEventListener('click', async () => {
  const { failed } = await store.outboxStatus();
  if (failed.length > 0) {
    showToast(`送れなかった理由: ${failed[0].error}。もう一度送ります`, 5000);
    await store.retryFailed();
  } else {
    showToast('電波が戻ると自動で送ります。今送ってみます');
    await store.sync();
  }
});

// ===== 記録する =====

const draft = {};

function resetDraft() {
  if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
  Object.assign(draft, {
    mode: null, photo: null, previewUrl: null, position: null, positionError: null, positionDenied: false,
    positionPromise: null, sheetShown: false,
  });
}
resetDraft();

// 誰の記録かはログインで決まる(各自が自分のスマホから記録する)
$('record-btn').addEventListener('click', () => {
  resetDraft();
  draft.mode = 'now';
  // 写真を撮っている間に現在地を取っておく(1回だけ)
  draft.positionPromise = getPositionOnce().then(
    (pos) => { draft.position = pos; },
    (err) => { draft.positionError = err.message; draft.positionDenied = !!err.denied; }
  );
  $('camera-input').value = '';
  $('camera-input').click();
});

$('later-btn').addEventListener('click', () => {
  resetDraft();
  draft.mode = 'later';
  $('library-input').value = '';
  $('library-input').click();
});

async function takePhoto(input) {
  const file = input.files?.[0];
  if (!file) return false;
  try {
    const { blob } = await shrinkPhoto(file);
    draft.photo = blob;
    draft.previewUrl = URL.createObjectURL(blob);
    return true;
  } catch (e) {
    showToast(e.message || '写真を読み込めませんでした');
    resetDraft();
    return false;
  }
}

$('camera-input').addEventListener('change', async (e) => {
  if (!(await takePhoto(e.target))) return;
  openRecordSheet();
  updateLocStatus('現在地を取得中…', false);
  await draft.positionPromise;
  if (draft.mode !== 'now' || $('record-sheet').hidden) return; // 途中でやめた・地図で選び始めた
  if (draft.position) {
    updateLocStatus(`現在地OK(誤差 約${draft.position.accuracy}m)`, true);
    $('pick-place-btn').textContent = '場所を地図で直す';
  } else {
    updateLocStatus(`${draft.positionError || '現在地がわかりませんでした'}。地図で場所を選んでください`, false);
    if (draft.positionDenied) {
      $('perm-help-btn').hidden = false;
      openPermHelp();
    }
  }
  $('pick-place-btn').hidden = false;
});

$('library-input').addEventListener('change', async (e) => {
  if (!(await takePhoto(e.target))) return;
  startPlacePick();
});

function openRecordSheet() {
  $('record-preview').src = draft.previewUrl;
  if (!draft.sheetShown) {
    $('record-memo').value = trialMode ? '試験 ' : '';
    recordStars.set(null);
    $('record-date').value = store.todayKey();
    draft.sheetShown = true;
  }
  $('date-row').hidden = draft.mode !== 'later';
  $('perm-help-btn').hidden = true;
  $('pick-place-btn').hidden = draft.mode !== 'later';
  $('pick-place-btn').textContent = draft.mode === 'later' ? '場所を選び直す' : '地図で場所を選ぶ';
  $('bottom-bar').hidden = true;
  $('record-sheet').hidden = false;
}

function updateLocStatus(text, ok) {
  $('loc-status').textContent = text;
  $('loc-status').className = ok ? 'loc-status ok' : 'loc-status';
  $('record-save').disabled = !ok;
}

function closeRecordSheet() {
  $('record-sheet').hidden = true;
  $('bottom-bar').hidden = false;
}

$('record-cancel').addEventListener('click', () => {
  closeRecordSheet();
  resetDraft();
});

$('pick-place-btn').addEventListener('click', () => {
  $('record-sheet').hidden = true;
  startPlacePick();
});

// 位置情報を拒否された時の再許可手順
function openPermHelp() {
  $('perm-steps').replaceChildren(buildSteps());
  $('perm-modal').hidden = false;
}

$('perm-help-btn').addEventListener('click', openPermHelp);
$('perm-close').addEventListener('click', () => { $('perm-modal').hidden = true; });

// 地図で場所を選ぶ(後から登録・現在地が取れなかった時・位置を直したい時)
// 十字は「地図の表示部分」の真ん中に置き、保存する位置は十字の中心の点から計算する。
// (以前は十字を画面全体の真ん中に置いていたため、上の帯の高さの半分だけ十字と保存位置がずれていた)
const STATION_SNAP_PX = 40; // 十字からこの画素以内に道の駅があれば「○○に記録しますか」と聞く

function positionCrosshair() {
  const r = map.getContainer().getBoundingClientRect();
  $('crosshair').style.left = `${r.left + r.width / 2}px`;
  $('crosshair').style.top = `${r.top + r.height / 2}px`;
}

function crosshairLatLng() {
  const r = map.getContainer().getBoundingClientRect();
  const c = $('crosshair').getBoundingClientRect();
  return map.containerPointToLatLng(L.point(c.left + c.width / 2 - r.left, c.top + c.height / 2 - r.top));
}

window.addEventListener('resize', () => { if (!$('crosshair').hidden) positionCrosshair(); });

function startPlacePick() {
  if (draft.position) map.setView([draft.position.lat, draft.position.lng], Math.max(map.getZoom(), 15));
  map.closePopup();
  $('bottom-bar').hidden = true;
  $('crosshair').hidden = false;
  $('place-bar').hidden = false;
  positionCrosshair();
}

function endPlacePick() {
  $('crosshair').hidden = true;
  $('place-bar').hidden = true;
}

function finishPlacePick(position, label) {
  draft.position = { ...position, accuracy: null };
  endPlacePick();
  openRecordSheet();
  $('pick-place-btn').hidden = false;
  $('pick-place-btn').textContent = '場所を選び直す';
  updateLocStatus(label, true);
}

$('place-ok').addEventListener('click', () => {
  const ll = crosshairLatLng();
  const station = window.michiLayer.isEnabled() ? window.michiLayer.nearestWithinPx(ll, STATION_SNAP_PX) : null;
  if (!station) {
    finishPlacePick({ lat: ll.lat, lng: ll.lng }, '地図で選んだ場所');
    return;
  }
  // 自動では引っぱらない。聞いてから決める
  $('snap-text').textContent = `道の駅 ${station.name} に記録しますか?`;
  $('snap-modal').hidden = false;
  $('snap-yes').onclick = () => {
    $('snap-modal').hidden = true;
    finishPlacePick({ lat: station.lat, lng: station.lng }, `道の駅 ${station.name}`);
  };
  $('snap-no').onclick = () => {
    $('snap-modal').hidden = true;
    finishPlacePick({ lat: ll.lat, lng: ll.lng }, '地図で選んだ場所');
  };
});

// 「道の駅を選ぶ」: 一覧から選ぶと、地図がその駅に移る(十字が駅に重なる)
$('place-station').addEventListener('click', async () => {
  let origin;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') {
      const pos = await getPositionOnce(8000);
      origin = { lat: pos.lat, lng: pos.lng, label: '現在地から' };
    }
  } catch { /* 現在地が使えなければ地図の中心から */ }
  if (!origin) {
    const ll = crosshairLatLng();
    origin = { lat: ll.lat, lng: ll.lng, label: '地図の中心から' };
  }
  $('place-bar').hidden = true;
  openStationPicker($('station-picker'), {
    stations: window.michiLayer.stations(),
    visited: window.michiLayer.visitedMap(),
    origin,
    onPick: (s) => {
      map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16), { animate: false });
      positionCrosshair();
    },
    onClose: () => { $('place-bar').hidden = false; },
  });
});

$('place-cancel').addEventListener('click', () => {
  endPlacePick();
  if (draft.sheetShown) {
    $('record-sheet').hidden = false;
  } else {
    $('bottom-bar').hidden = false;
    resetDraft();
  }
});

function recordedAtValue() {
  if (draft.mode !== 'later') return new Date().toISOString();
  const day = $('record-date').value;
  return day ? new Date(`${day}T12:00:00`).toISOString() : new Date().toISOString();
}

$('record-save').addEventListener('click', async () => {
  if (!draft.photo || !draft.position) return;
  if (trialMode && !$('record-memo').value.includes('試験')) {
    showToast('試験中です。一言の欄に「試験」と書いてください(後で消すための目印です)', 5000);
    return;
  }
  $('record-save').disabled = true;
  try {
    await store.createRecord({
      lat: draft.position.lat,
      lng: draft.position.lng,
      photoBlob: draft.photo,
      memo: $('record-memo').value.trim(),
      stars: recordStars.get(),
      recordedAt: recordedAtValue(),
    });
    closeRecordSheet();
    map.setView([draft.position.lat, draft.position.lng], Math.max(map.getZoom(), 14));
    resetDraft();
    await store.sync();
    const { pending } = await store.outboxStatus();
    showToast(pending > 0 ? 'スマホに保存しました。電波が戻ると送ります' : '保存しました');
  } catch (e) {
    showToast(`保存できませんでした: ${e.message}`);
    $('record-save').disabled = false;
  }
});

// ===== 一言・星 =====

let notePin = null;
let noteMode = null;

function openNoteSheet(pin, mode) {
  notePin = pin;
  noteMode = mode;
  map.closePopup();
  $('note-title').textContent = mode === 'edit' ? 'メモ・星を直す' : `${pin.recorderName}の記録に一言・星`;
  $('note-memo').value = mode === 'edit' ? pin.memo : '';
  noteStars.set(mode === 'edit' ? pin.stars : null);
  $('bottom-bar').hidden = true;
  $('note-sheet').hidden = false;
}

function closeNoteSheet() {
  $('note-sheet').hidden = true;
  $('bottom-bar').hidden = false;
}

$('note-cancel').addEventListener('click', closeNoteSheet);

$('note-save').addEventListener('click', async () => {
  const memo = $('note-memo').value.trim();
  const stars = noteStars.get();
  if (noteMode === 'reaction' && !memo && !stars) {
    showToast('一言か星を入れてください');
    return;
  }
  closeNoteSheet();
  if (noteMode === 'edit') await store.updatePin(notePin.id, memo, stars);
  else await store.addReaction(notePin.id, memo, stars);
  showToast('保存しました');
});

// ===== 自動送信のきっかけ =====
// iPhoneはアプリを閉じている間は送れないので、開いた時・電波が戻った時・開いている間の定期確認で送る

store.events.addEventListener('change', () => { render(); });
window.addEventListener('online', () => { if (me) store.sync(); });
window.addEventListener('offline', () => render());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && me) {
    store.sync();
    render();
  }
});
setInterval(async () => {
  if (document.visibilityState !== 'visible' || !me) return;
  const { pending } = await store.outboxStatus();
  if (pending > 0) store.sync();
}, 30000);

// ===== 試験用パネル(?dev=1) =====

function setupDevPanel() {
  if (params.get('dev') !== '1') return;
  $('dev-panel').hidden = false;
  $('dev-me').textContent = `${store.usingMock ? '見本' : '本物'}の保存先: ${me.name}`;
  // 「圏外のふり」「見本を初期化」は見本の保存先(?mock=1)の時だけ。
  // 本物の時に初期化すると、まだ送れていない記録まで消えてしまうため出さない
  if (!store.usingMock) {
    $('dev-offline').closest('label').hidden = true;
    $('dev-reset').hidden = true;
    return;
  }
  $('dev-offline').addEventListener('change', (e) => {
    store.setFakeOffline(e.target.checked);
    if (!e.target.checked) store.sync();
  });
  $('dev-reset').addEventListener('click', async () => {
    await store.resetLocalData();
    location.reload();
  });
}

// ===== 新しい版の確認 =====
// 画面の部品はスマホに控えて素早く開く。開いた時・戻ってきた時に新しい版を確かめ、
// あれば「更新する」を出す。押すと新しい版に切り替えて読み込み直す(記録中に勝手に切り替えない)。

let waitingWorker = null;

function offerUpdate(worker) {
  waitingWorker = worker;
  $('update-bar').hidden = false;
}

$('update-btn').addEventListener('click', () => {
  $('update-btn').disabled = true;
  if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
});

async function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  const hadController = !!navigator.serviceWorker.controller;
  const reg = await navigator.serviceWorker.register('sw.js');
  if (reg.waiting && hadController) offerUpdate(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      // 初めての読み込みでは出さない(すでに古い版が動いている時だけ)
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
    });
  });

  const check = () => reg.update().catch(() => { /* 圏外なら次の機会に */ });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  check();

  if (params.get('dev') === '1') {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { $('dev-version').textContent = `版: ${e.data}`; };
    (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  }
}

// ===== ログイン =====
// パスワードはこの画面で保存先に渡すだけで、アプリは保存しない。

function askLogin() {
  $('login-screen').hidden = false;
  $('login-email').focus();
  return new Promise((resolve) => {
    $('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('login-email').value.trim();
      const password = $('login-password').value;
      $('login-error').textContent = '';
      $('login-btn').disabled = true;
      try {
        const user = await store.signIn(email, password);
        $('login-password').value = '';
        $('login-screen').hidden = true;
        resolve(user);
      } catch (err) {
        $('login-error').textContent = err.message;
      } finally {
        $('login-btn').disabled = false;
      }
    };
  });
}

$('user-chip').addEventListener('click', async () => {
  const { pending, failed } = await store.outboxStatus();
  const unsent = pending + failed.length;
  const message = unsent > 0
    ? `まだ送れていない記録などが${unsent}件あります。ログアウトすると消えます。それでもログアウトしますか?`
    : `${me.name}さんのログインを終了しますか?`;
  if (!confirm(message)) return;
  await store.signOut();
  location.reload();
});

// ===== 起動 =====

setupUpdates().catch(() => { /* 使えなくても通常表示は続ける */ });

me = await store.init();
if (!me) me = await askLogin();
$('user-chip').textContent = `👤 ${me.name}`;
$('user-chip').hidden = !store.needsLogin;
setupDevPanel();
$('trial-bar').hidden = !trialMode;
await loadStationInfo();
await render();
store.sync();
