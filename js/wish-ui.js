// 「行きたい店メモ」の画面。
// 残すのは店名とピンの位置だけ。道案内は、ピンの位置を Googleマップに渡して Googleマップでしてもらう。
// 住所・プラスコード・元のリンクは、ピンを立てる場所を探すための道具(分かった時だけ裏で控え、画面には出さない)。
// 追加・直すは1画面で上から順に: すぐメモ(店名だけ)→ ① 貼る → ② 店名 → ③ 場所(ピン)→ ④ そのほか。
// 外への問い合わせは「この店名で探す」「この住所で場所を探す」「プラスコードから場所を決める」を押した時だけ(geocode.js の決まり)。
// Googleのページを開いて読むことはしない(リンクを開くだけ)。
import { parsePaste } from './wish-parse.js';
import { searchPlaces, ATTRIBUTION } from './geocode.js';
import { recoverNearest, decode } from './olc.js';
import { checkWish, GENRES, provisionalName } from './wish-check.js';
import { distanceM } from './michi-layer.js';

const STORAGE_KEY = 'wishLayer';
const FIXED_RECOMMENDERS = ['長男', '次男', '番組'];
const DUPLICATE_M = 100; // この距離以内で名前が似ていれば、二重登録かもしれないと知らせる
const NO_PLACE = '__noplace'; // 一覧の「場所が未定」の絞り込み
// 道案内の乗り物: Googleマップの公式の説明には two-wheeler(バイク)があるが「対応している国にいる時だけ」とあり、
// 日本が対応しているか確かめられなかったので、確実に使える driving(車)にする
const TRAVEL_MODE = 'driving';

const $ = (id) => document.getElementById(id);
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
const link = (cls, text, href) => {
  const a = el('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};
const normName = (s) => (s || '').normalize('NFKC').replace(/[\s・()【】「」]/g, '').toLowerCase();
const coord = (x) => String(Number(Number(x).toFixed(6)));
const hasPlace = (w) => w.lat != null && w.lng != null;

// 「場所:」の出し方(決まり方に合わせる)
function placeText(source, label) {
  if (source === 'map') return '場所: ピンで決めた場所';
  if (source === 'search') return '場所: 検索から(おおよそ)。ピンを動かして直せます';
  if (source === 'plus_code') return '場所: プラスコードから';
  if (source === 'url') return label === 'apple' ? '場所: Appleマップのリンクから' : '場所: アドレスから';
  return '場所: まだ決まっていません。ピンを動かして、店の場所に合わせてください';
}

// Googleマップで見る: 場所があればその位置、なければ店名(仮の名前の時は控えた住所)で探す
export function googleMapsViewUrl(w) {
  if (hasPlace(w)) return `https://www.google.com/maps/search/?api=1&query=${coord(w.lat)},${coord(w.lng)}`;
  const query = w.provisional && w.address ? w.address : [w.name, w.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
// ここへ行く(Googleマップで案内): 出発地は指定しない(今いる場所から)。場所がない店は null
export function googleMapsDirUrl(w) {
  if (!hasPlace(w)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${coord(w.lat)},${coord(w.lng)}&travelmode=${TRAVEL_MODE}`;
}
// 前の名前も残す(ほかの場所から呼ばれている時のため)
export const googleMapsUrlForWish = googleMapsViewUrl;

function readEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}
function writeEnabled(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
}

// 店名の検索で見つからない時に外す、よくある言葉(例: 「中国料理 揚子江」→「揚子江」で、もう1回だけ探す)
const GENERIC_WORD_RE = /^(中国料理|中華料理|中華|四川料理|広東料理|台湾料理|ラーメン|らーめん|拉麺|中華そば|そば|蕎麦|うどん|食堂|レストラン|カフェ|喫茶|喫茶店|焼肉|寿司|すし|鮨|居酒屋|洋食|和食|定食|とんかつ|お好み焼き|たこ焼き|パン|ベーカリー|本店)$/;
export function simplerName(q) {
  const words = q.split(/\s+/).filter(Boolean);
  const rest = words.filter((w) => !GENERIC_WORD_RE.test(w));
  return rest.length && rest.length < words.length ? rest.join(' ') : null;
}

const fmtKm = (km) => (km < 1 ? `約${Math.max(0.1, Math.round(km * 10) / 10)}km` : `約${km < 10 ? Math.round(km * 10) / 10 : Math.round(km)}km`);

export function initWishUI({ map, store, showToast, startRecordFromWish, todayInJapan }) {
  map.createPane('wish');
  map.getPane('wish').style.zIndex = 540; // 行った駅(650) > 記録ピン(600) > 行きたい(540) > 🍌(520) > 行っていない駅(450)
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();
  let wishes = [];
  let enabled = readEnabled();
  let edit = null;
  let listFilter = null;
  let mini = null;       // 追加画面の中の小さな地図
  let miniMarker = null; // 小さな地図のピン(いつも出ている。場所が決まるまではうすい色)
  let doneTimer = null;

  // ===== 地図の印 =====
  function icon(w) {
    const cls = ['wish-mark', w.visitedOn ? 'visited' : '', w.private ? 'private' : ''].filter(Boolean).join(' ');
    return L.divIcon({
      className: '',
      html: `<div class="${cls}" data-id="${w.id}"><span>${w.visitedOn ? '✓' : '行'}</span></div>`,
      iconSize: [40, 46],
      iconAnchor: [20, 44], // しおりの切れ込みの下が場所
      popupAnchor: [0, -40],
    });
  }

  function nameLine(w, cls, prefix = '') {
    const p = el('p', cls, `${prefix}${w.name}`);
    if (w.provisional) p.append(' ', el('span', 'wish-provisional', '仮'));
    return p;
  }

  // Googleマップへ渡すボタン(場所がある店は「見る」と「ここへ行く」、ない店は店名で探す)
  function gmapLinks(w, small = false) {
    const box = el('div', small ? 'wish-gmap-links small' : 'wish-gmap-links');
    if (hasPlace(w)) {
      box.append(link('gmap-btn', 'Googleマップで見る', googleMapsViewUrl(w)));
      box.append(link('gmap-dir', 'ここへ行く(Googleマップで案内)', googleMapsDirUrl(w)));
    } else {
      box.append(link('gmap-btn', 'Googleマップで探す', googleMapsViewUrl(w)));
    }
    for (const a of box.querySelectorAll('a')) a.addEventListener('click', (e) => e.stopPropagation());
    return box;
  }

  function popup(w) {
    const box = el('div', 'wish-popup');
    box.dataset.id = w.id;
    box.append(nameLine(w, 'wish-name', '行きたい: '));
    if (w.provisional) box.append(el('p', 'wish-sub warn', '仮の名前です。店名が分かったら「直す」で入れてください'));
    if (w.genre) box.append(el('p', 'wish-sub', `ジャンル: ${w.genre}`));
    if (w.recommenders.length) box.append(el('p', 'wish-recs', `おすすめ: ${w.recommenders.join('・')}`));
    if (w.memo) box.append(el('p', 'wish-memo', w.memo));
    if (w.positionSource === 'search') box.append(el('p', 'wish-sub warn', '位置はおおよそ(検索から)'));
    if (w.positionSource === 'plus_code') box.append(el('p', 'wish-sub', '場所: プラスコードから'));
    if (w.private) box.append(el('p', 'wish-sub', '🔒 自分だけのメモ(家族には見えません)'));
    if (w.visitedOn) box.append(el('p', 'wish-visited', `✓ 行った(${w.visitedOn.replace(/-/g, '/')})`));
    box.append(gmapLinks(w));
    if (w.mine) {
      if (!w.visitedOn && hasPlace(w)) box.append(btn('btn main wide wish-go', '行った(記録する)', () => startRecordFromWish(w)));
      box.append(btn('btn sub wide wish-edit', '直す', () => openSheet(w)));
      box.append(btn('delete-link wish-delete', 'この行きたい店を消す', async () => {
        if (!confirm(`「${w.name}」を行きたい店から消します。もとに戻せません。消しますか?`)) return;
        try {
          await store.deleteWish(w.id);
          map.closePopup();
          showToast('行きたい店から消しました');
        } catch (e) { showToast(e.message, 5000); }
      }));
    }
    return box;
  }

  function draw() {
    layer.clearLayers();
    markers.clear();
    $('wish-chip').classList.toggle('on', enabled);
    $('wish-chip').textContent = enabled ? '行きたい' : '行きたい オフ';
    if (!enabled) return;
    for (const w of wishes) {
      if (!hasPlace(w)) continue;
      const m = L.marker([w.lat, w.lng], { icon: icon(w), pane: 'wish', keyboard: false })
        .bindPopup(() => popup(w), { maxWidth: 260, autoPanPaddingTopLeft: L.point(64, 16) })
        .addTo(layer);
      markers.set(w.id, m);
    }
  }

  async function refresh() {
    try { wishes = await store.loadWishes(); } catch { wishes = []; }
    draw();
  }

  $('wish-chip').addEventListener('click', () => {
    enabled = !enabled;
    writeEnabled(enabled);
    draw();
  });

  // ===== 追加・直す画面 =====
  function recommenderChoices() {
    const names = store.members().map((m) => m.name);
    const used = wishes.flatMap((w) => w.recommenders);
    return [...new Set([...names, ...FIXED_RECOMMENDERS, ...used])];
  }

  function renderRecs() {
    $('wish-recs').replaceChildren(...[...new Set([...recommenderChoices(), ...edit.recs])].map((name) => {
      const b = btn(`rec-chip${edit.recs.has(name) ? ' on' : ''}`, name, () => {
        if (edit.recs.has(name)) edit.recs.delete(name); else edit.recs.add(name);
        renderRecs();
      });
      b.setAttribute('aria-pressed', String(edit.recs.has(name)));
      return b;
    }));
  }

  function renderGenres() {
    $('wish-genres').replaceChildren(...GENRES.map((g) => {
      const b = btn(`rec-chip genre${edit.genre === g ? ' on' : ''}`, g, () => {
        edit.genre = edit.genre === g ? null : g;
        renderGenres();
      });
      b.dataset.genre = g;
      b.setAttribute('aria-pressed', String(edit.genre === g));
      return b;
    }));
  }

  function plusPending() {
    return edit.plusCode && !edit.plusCode.full && edit.lat == null;
  }

  function renderButtons() {
    $('wish-search').textContent = plusPending() ? 'プラスコードから場所を決める' : 'この店名で探す';
    // 住所が分かっていて場所がまだの時は「この住所で場所を探す」を目立たせる
    $('wish-address-search').hidden = !(edit.address && edit.lat == null && !plusPending());
  }

  // 「Googleマップで探す」は、店名で Googleマップの検索を新しいタブで開く(リンクを開くだけ)
  function updateGmapsFind() {
    const name = $('wish-name').value.trim();
    $('wish-gmaps-find').href = name
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`
      : 'https://www.google.com/maps/';
  }
  $('wish-name').addEventListener('input', updateGmapsFind);
  $('wish-gmaps-find').addEventListener('click', (e) => {
    if ($('wish-name').value.trim()) return;
    e.preventDefault();
    $('wish-paste-msg').textContent = '先に店名を入れてから「Googleマップで探す」を押してください。';
  });

  // スマホ(指で触る画面)では、追加画面の小さな地図を「1本指のなぞり=画面のスクロール」「2本指=地図を動かす・拡大縮小」にする。
  // 画面のスクロールと地図の取り合いを防ぐため。ピンは1本指で動かせる。地図を押す(タップ)とピンが移る。
  const touchMode = (navigator.maxTouchPoints || 0) > 0 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const HINT_KEY = 'miniTwoFingerUsed';
  const HINT_ENOUGH = 3; // 2本指で3回動かしたら、案内を出さない

  function readHintCount() {
    try { return Number(localStorage.getItem(HINT_KEY)) || 0; } catch { return 0; }
  }

  function pinIcon(tentative) {
    return L.divIcon({
      className: '',
      html: `<div class="wish-mark editing${tentative ? ' tentative' : ''}"><span>行</span></div>`,
      iconSize: [40, 46],
      iconAnchor: [20, 44],
    });
  }

  function ensureMini() {
    if (mini) return;
    mini = L.map('wish-minimap', {
      zoomControl: true,
      attributionControl: true,
      dragging: !touchMode,  // 指の時は1本指で地図を動かさない(2本指は touchZoom が動かす)
      touchZoom: true,       // 2本指で動かす・拡大縮小(2本の指の真ん中に合わせて動く)
      scrollWheelZoom: true, // パソコンはマウスのホイールで拡大縮小
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mini);
    // 地図を押す(クリック・タップ)・長押し・右クリックで、そこにピンを置く
    mini.on('click', (e) => setPlace(e.latlng.lat, e.latlng.lng, 'map', { recenter: false }));
    mini.on('contextmenu', (e) => setPlace(e.latlng.lat, e.latlng.lng, 'map', { recenter: false }));
    // 右クリックの時にブラウザのメニューを出さない
    mini.getContainer().addEventListener('contextmenu', (e) => e.preventDefault());
    // 場所が決まるまでは、うすいピンが地図の真ん中についてくる
    mini.on('move', () => {
      if (edit && edit.lat == null && miniMarker) miniMarker.setLatLng(mini.getCenter());
    });
    miniMarker = L.marker([0, 0], { draggable: true, icon: pinIcon(true), keyboard: false }).addTo(mini);
    miniMarker.on('dragend', () => {
      const ll = miniMarker.getLatLng();
      setPlace(ll.lat, ll.lng, 'map', { recenter: false });
    });
    if (touchMode) {
      const box = mini.getContainer();
      box.classList.add('two-finger');
      const hint = el('div', 'wish-touch-hint', '2本の指で地図を動かせます');
      hint.hidden = readHintCount() >= HINT_ENOUGH;
      box.append(hint);
      box.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 2) return;
        const n = readHintCount() + 1;
        try { localStorage.setItem(HINT_KEY, String(n)); } catch { /* 覚えられなくても動く */ }
        if (n >= HINT_ENOUGH) hint.hidden = true;
      }, { passive: true });
    }
  }

  function renderPlace({ recenter = true } = {}) {
    const has = edit.lat != null;
    $('wish-place-status').textContent = placeText(has ? edit.positionSource : null, edit.placeLabel);
    $('wish-place-status').className = `wish-place-status${has ? '' : ' none'}`;
    renderButtons();
    if (!mini || !miniMarker) return;
    miniMarker.setIcon(pinIcon(!has));
    if (has) {
      miniMarker.setLatLng([edit.lat, edit.lng]);
      if (recenter) mini.setView([edit.lat, edit.lng], Math.max(mini.getZoom() || 0, 16), { animate: false });
    } else {
      miniMarker.setLatLng(mini.getCenter());
    }
  }

  // 場所が決まった(ピンを動かした・地図を押した・貼り付け・検索の候補・プラスコード)
  function setPlace(lat, lng, source, { recenter = true, label = null } = {}) {
    if (!edit) return;
    edit.lat = lat;
    edit.lng = lng;
    edit.positionSource = source;
    edit.placeLabel = label;
    edit.dupConfirmed = false;
    renderPlace({ recenter });
    const done = $('wish-place-done');
    done.hidden = false;
    clearTimeout(doneTimer);
    doneTimer = setTimeout(() => { done.hidden = true; }, 2500);
  }

  function openSheet(w = null) {
    map.closePopup();
    edit = {
      id: w?.id || null,
      lat: w?.lat ?? null, lng: w?.lng ?? null, positionSource: w?.positionSource ?? null, placeLabel: null,
      address: w?.address || '', sourceUrl: w?.sourceUrl || null, // 裏で控える(画面には出さない)
      plusCode: null, recs: new Set(w?.recommenders || []), genre: w?.genre || null,
      provisionalName: w?.provisional ? w.name : null, dupConfirmed: false,
    };
    $('wish-sheet-title').textContent = w ? '行きたい店を直す' : '行きたい店を追加';
    $('wish-quick').hidden = !!w;
    $('wish-quick-name').value = '';
    $('wish-quick-error').textContent = '';
    $('wish-paste').value = '';
    $('wish-paste-msg').textContent = '';
    clearSearchMsg();
    // 仮の名前の時は、店名の欄を空にして入れやすくする(空のまま保存すれば仮の名前のまま)
    $('wish-name').value = w && !w.provisional ? w.name : '';
    $('wish-name').placeholder = w?.provisional ? `${w.name} のまま(店名が分かったら入れる)` : '例: 中国料理 揚子江';
    updateGmapsFind();
    $('wish-candidates').replaceChildren();
    $('wish-wider').hidden = true;
    $('wish-memo').value = w?.memo || '';
    $('wish-private').checked = !!w?.private;
    $('wish-rec-free').value = '';
    $('wish-warn').textContent = '';
    $('wish-error').textContent = '';
    $('wish-place-done').hidden = true;
    renderRecs();
    renderGenres();
    $('bottom-bar').hidden = true;
    $('wish-sheet').hidden = false;
    $('wish-sheet').scrollTop = 0;
    ensureMini();
    // 小さな地図は、画面が出てから大きさを測り直す。場所がない時は今の大きな地図の真ん中から始める
    if (edit.lat == null) mini.setView(map.getCenter(), Math.max(map.getZoom(), 13), { animate: false });
    renderPlace();
    setTimeout(() => {
      if (!edit) return;
      mini.invalidateSize();
      if (edit.lat == null) mini.setView(map.getCenter(), Math.max(map.getZoom(), 13), { animate: false });
      renderPlace();
    }, 0);
  }

  function closeSheet() {
    $('wish-sheet').hidden = true;
    $('bottom-bar').hidden = false;
    edit = null;
  }

  function readPaste() {
    if (!edit) return;
    const r = parsePaste($('wish-paste').value); // 貼った文字は消さない
    $('wish-paste-msg').textContent = r.message;
    if (r.name && !$('wish-name').value) $('wish-name').value = r.name;
    if (r.address) edit.address = r.address;       // 住所は裏で控える(ピンを立てる場所を探す道具)
    if (r.sourceUrl) edit.sourceUrl = r.sourceUrl; // リンクは開かず、控えるだけ
    edit.plusCode = r.plusCode;
    updateGmapsFind();
    if (r.position) setPlace(r.position.lat, r.position.lng, r.positionSource, { label: r.positionLabel });
    renderButtons();
  }

  $('wish-read').addEventListener('click', readPaste);
  $('wish-paste').addEventListener('paste', () => setTimeout(readPaste, 0)); // 貼ったらすぐ読み取る(端末の中だけ)

  // ほかのアプリから共有された文字(Android の共有メニュー)を、貼り付け欄に入れて読み取る。保存はしない
  function openWithShared(text) {
    openSheet();
    $('wish-paste').value = text;
    readPaste();
  }

  // すぐメモ: 店名だけで、場所なしで保存する
  $('wish-quick-save').addEventListener('click', async () => {
    const name = $('wish-quick-name').value.trim();
    const w = { name, provisional: false, genre: null, address: '', memo: '', sourceUrl: null, recommenders: [], lat: null, lng: null, positionSource: null, private: false, visitedOn: null };
    const err = checkWish(w);
    if (err) { $('wish-quick-error').textContent = err; return; }
    $('wish-quick-save').disabled = true;
    try {
      await store.addWish(w);
      closeSheet();
      showToast('保存しました。場所は、あとで決められます');
    } catch (e) {
      $('wish-quick-error').textContent = e.message;
    } finally {
      $('wish-quick-save').disabled = false;
    }
  });

  // 今見ている地図(大きな地図)を、近い順の基準と探す範囲にする
  function nearHere() {
    const c = map.getCenter();
    const b = map.getBounds().pad(0.5); // 見ている範囲より少し広く
    return { lat: c.lat, lng: c.lng, bounds: { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() } };
  }

  function clearSearchMsg() {
    $('wish-search-msg').textContent = '';
    $('wish-search-reason').textContent = '';
  }
  // 検索の案内。失敗の時は、短い理由を小さい文字で添える
  function sayFail(e) {
    $('wish-search-msg').textContent = e.message;
    $('wish-search-reason').textContent = e.reason ? `(理由: ${e.reason})` : '';
  }

  function showCandidates(results) {
    $('wish-candidates').replaceChildren(...results.map((r) => {
      const li = el('li', 'wish-candidate');
      li.append(el('span', 'cand-label', r.label));
      li.append(el('span', 'cand-km', r.km != null ? `ここから${fmtKm(r.km)}` : ''));
      li.append(el('span', 'cand-src', r.source === 'gsi' ? '国土地理院' : 'OpenStreetMap'));
      li.addEventListener('click', () => {
        setPlace(r.lat, r.lng, 'search');
        $('wish-candidates').replaceChildren();
        $('wish-wider').hidden = true;
        clearSearchMsg();
        $('wish-search-msg').textContent = 'ピンを付けました(位置はおおよそ)。ピンを動かして、店の場所に合わせてください。';
      });
      return li;
    }));
  }

  let lastQuery = null; // 「もっと遠くも探す」で同じ物を探す
  async function runSearch(kind, wide) {
    const searchBtn = $('wish-search');
    if (searchBtn.disabled) return;
    $('wish-candidates').replaceChildren();
    clearSearchMsg();
    const near = nearHere();
    // プラスコードの短い形: 地域名を1回だけ位置に直し、それを基準に完全な形に戻す
    if (kind === 'name' && plusPending()) {
      const area = edit.plusCode.locality;
      if (!area) {
        $('wish-search-msg').textContent = 'プラスコードの地域名が分かりません。ピンを動かして、店の場所に合わせてください。';
        return;
      }
      searchBtn.disabled = true;
      try {
        const found = await searchPlaces(area, { prefer: 'area' });
        if (!found.length) {
          $('wish-search-msg').textContent = `「${area}」が見つかりませんでした。ピンを動かして、店の場所に合わせてください。`;
          return;
        }
        const full = recoverNearest(edit.plusCode.code, found[0].lat, found[0].lng);
        const d = decode(full);
        edit.plusCode = { ...edit.plusCode, full: true, code: full };
        setPlace(d.lat, d.lng, 'plus_code');
        $('wish-search-msg').textContent = `プラスコード(${full})から場所を決めました。ずれていたら、ピンを動かして直してください。`;
      } catch (e) {
        sayFail(e);
      } finally {
        searchBtn.disabled = false;
        renderButtons();
      }
      return;
    }
    const q = kind === 'address' ? edit.address : $('wish-name').value.trim();
    if (!q) {
      $('wish-search-msg').textContent = '店名を入れてから「この店名で探す」を押してください。';
      return;
    }
    lastQuery = { kind, q };
    searchBtn.disabled = true;
    $('wish-address-search').disabled = true;
    $('wish-wider').disabled = true;
    const busyBtn = kind === 'address' ? $('wish-address-search') : searchBtn;
    const label = busyBtn.textContent;
    busyBtn.textContent = '探しています…';
    try {
      let results = await searchPlaces(q, { near, wide });
      // 店名で見つからず「中国料理」などの言葉が付いていれば、外してもう1回だけ探す(押した1回の中で。1秒に1回は守る)
      const simpler = kind === 'name' && !results.length ? simplerName(q) : null;
      let usedSimpler = null;
      if (simpler) {
        results = await searchPlaces(simpler, { near, wide });
        if (results.length) usedSimpler = simpler;
      }
      if (!results.length) {
        $('wish-search-msg').textContent = wide
          ? '見つかりませんでした。ピンを動かして、店の場所に合わせてください。'
          : 'この辺りには見つかりませんでした。「もっと遠くも探す」を押すか、ピンを動かして合わせてください。';
        $('wish-wider').hidden = wide;
        return;
      }
      $('wish-search-msg').textContent = `${usedSimpler ? `「${usedSimpler}」で探しました。` : ''}今の地図に近い順の候補です(最大5件)。合う物を選んでください。${wide ? '' : '見つからなければ「もっと遠くも探す」。'}`;
      showCandidates(results);
      $('wish-wider').hidden = wide;
    } catch (e) {
      sayFail(e);
    } finally {
      busyBtn.textContent = label;
      searchBtn.disabled = false;
      $('wish-address-search').disabled = false;
      $('wish-wider').disabled = false;
      renderButtons();
    }
  }

  $('wish-search').addEventListener('click', () => runSearch('name', false));
  $('wish-address-search').addEventListener('click', () => runSearch('address', false));
  $('wish-wider').addEventListener('click', () => runSearch(lastQuery?.kind || 'name', true));
  $('wish-search-attrib').textContent = `検索の出典: ${ATTRIBUTION.gsi} / ${ATTRIBUTION.osm}`;

  $('wish-rec-add').addEventListener('click', () => {
    const v = $('wish-rec-free').value.trim().slice(0, 20);
    if (!v) return;
    edit.recs.add(v);
    $('wish-rec-free').value = '';
    renderRecs();
  });

  // ===== 保存 =====
  function duplicateOf(w) {
    const n = normName(w.name);
    return wishes.find((x) => x.id !== edit.id && (
      (n && !w.provisional && normName(x.name) === n)
      || (w.lat != null && x.lat != null && distanceM(w.lat, w.lng, x.lat, x.lng) <= DUPLICATE_M
        && (w.provisional || x.provisional || normName(x.name).includes(n) || n.includes(normName(x.name))))
    ));
  }

  $('wish-save').addEventListener('click', async () => {
    let name = $('wish-name').value.trim();
    let provisional = false;
    if (!name && edit.provisionalName) {
      name = edit.provisionalName; // 仮の名前のまま
      provisional = true;
    } else if (!name && edit.genre) {
      name = provisionalName(edit.genre); // 例: 「ラーメン(仮)」
      provisional = true;
    }
    const w = {
      name,
      provisional,
      genre: edit.genre,
      address: edit.address || '',
      memo: $('wish-memo').value.trim(),
      sourceUrl: edit.sourceUrl || null,
      recommenders: [...edit.recs],
      lat: edit.lat, lng: edit.lng, positionSource: edit.positionSource,
      private: $('wish-private').checked,
      visitedOn: edit.id ? (wishes.find((x) => x.id === edit.id)?.visitedOn || null) : null,
    };
    const err = checkWish(w);
    if (err) {
      $('wish-error').textContent = err === '店名を入れてください' ? '店名を入れるか、ジャンルを選んでください(ジャンルなら仮の名前で保存できます)' : err;
      return;
    }
    const dup = duplicateOf(w);
    if (dup && !edit.dupConfirmed) {
      const far = dup.lat != null && w.lat != null ? `・約${Math.round(distanceM(w.lat, w.lng, dup.lat, dup.lng))}m` : '';
      $('wish-warn').textContent = `同じ店かもしれません: 「${dup.name}」(${dup.recommenders.join('・') || 'おすすめなし'}${far})。それでも保存する時は、もう一度「保存」を押してください。`;
      edit.dupConfirmed = true;
      return;
    }
    // ピンがうすい色のまま(場所が決まっていない)なら確かめる
    if (w.lat == null && !confirm('場所が決まっていません。このまま保存しますか(地図には出ません)')) return;
    $('wish-save').disabled = true;
    $('wish-error').textContent = '';
    try {
      if (edit.id) await store.updateWish(edit.id, w);
      else await store.addWish(w);
      closeSheet();
      showToast(w.lat == null ? '保存しました。場所は、あとで決められます' : provisional ? `「${name}」で保存しました。店名が分かったら「直す」で入れてください` : '行きたい店に保存しました');
    } catch (e) {
      $('wish-error').textContent = e.message;
    } finally {
      $('wish-save').disabled = false;
    }
  });
  $('wish-cancel').addEventListener('click', closeSheet);
  $('wish-add-btn').addEventListener('click', () => openSheet());

  // ===== 一覧(おすすめした人・場所が未定で絞り込み) =====
  function renderList() {
    const sheet = $('wish-list-sheet');
    const close = () => { sheet.hidden = true; $('bottom-bar').hidden = false; };
    const head = el('div', 'picker-head');
    head.append(el('h2', 'sheet-title', '行きたい店の一覧'), btn('btn sub picker-close', '閉じる', close));
    const people = [...new Set(wishes.flatMap((w) => w.recommenders))];
    const tabs = el('div', 'picker-tabs wrap');
    const noPlaceCount = wishes.filter((w) => !hasPlace(w)).length;
    for (const p of [null, NO_PLACE, ...people]) {
      const text = p === null ? 'すべて' : p === NO_PLACE ? `場所が未定(${noPlaceCount})` : `${p}おすすめ`;
      const b = btn(`picker-tab${listFilter === p ? ' active' : ''}`, text, () => { listFilter = p; renderList(); });
      b.dataset.filter = p || '';
      tabs.append(b);
    }
    const shown = wishes.filter((w) => listFilter === null || (listFilter === NO_PLACE ? !hasPlace(w) : w.recommenders.includes(listFilter)));
    const ul = el('ul', 'picker-list');
    for (const w of shown) {
      const li = el('li', 'picker-item wish-item');
      li.dataset.id = w.id;
      const body = el('span', 'picker-body');
      const title = el('span', 'picker-name', `${w.visitedOn ? '✓ ' : ''}${w.private ? '🔒 ' : ''}${w.name}`);
      if (w.provisional) title.append(' ', el('span', 'wish-provisional', '仮'));
      if (!hasPlace(w)) title.append(' ', el('span', 'wish-noplace', '場所が未定'));
      body.append(title, el('span', 'picker-sub', [w.recommenders.length ? `おすすめ: ${w.recommenders.join('・')}` : '', w.memo].filter(Boolean).join(' / ')));
      body.append(gmapLinks(w, true));
      if (!hasPlace(w) && w.mine) {
        body.append(btn('btn sub wish-decide', '場所を決める', (e) => {
          e.stopPropagation();
          close();
          openSheet(w);
        }));
      }
      li.append(el('span', `picker-mark wish${w.visitedOn ? ' visited' : ''}`, w.visitedOn ? '✓' : '行'), body);
      li.addEventListener('click', () => {
        if (!hasPlace(w)) {
          if (w.mine) { close(); openSheet(w); } else showToast('この店は場所がまだ決まっていません');
          return;
        }
        close();
        if (!enabled) { enabled = true; writeEnabled(true); draw(); }
        map.setView([w.lat, w.lng], Math.max(map.getZoom(), 15), { animate: false });
        markers.get(w.id)?.openPopup();
      });
      ul.append(li);
    }
    if (!shown.length) ul.append(el('li', 'picker-empty', wishes.length ? '当てはまる店はありません' : 'まだありません。「行きたい追加」から入れてください'));
    sheet.replaceChildren(head, tabs, ul);
  }

  $('wish-list-btn').addEventListener('click', () => {
    renderList();
    $('bottom-bar').hidden = true;
    $('wish-list-sheet').hidden = false;
  });

  // 記録が済んだ行きたい店に「行った」の印を付ける(消さずに残す。後で「おすすめ採用」を数えるため)
  async function markVisited(w, day) {
    const cur = wishes.find((x) => x.id === w.id) || w;
    await store.updateWish(w.id, { ...cur, visitedOn: day || todayInJapan() });
    showToast(`「${w.name}」に行った印を付けました`);
  }

  draw();
  return {
    refresh, markVisited, openSheet, openWithShared,
    wishes: () => wishes, isEnabled: () => enabled, markerIds: () => [...markers.keys()],
    miniMap: () => mini, miniMarkerLatLng: () => miniMarker?.getLatLng() ?? null, miniTouchMode: () => touchMode,
    editState: () => (edit ? { address: edit.address, sourceUrl: edit.sourceUrl, lat: edit.lat, lng: edit.lng, positionSource: edit.positionSource, placeLabel: edit.placeLabel } : null),
  };
}
