// 「行きたい店メモ」の画面。
// 追加・直すは1画面で上から順に: ① 貼る(なくてもOK)→ ② 店名(ジャンルで仮の名前も可)→ ③ 場所(この店名で探す・小さな地図で確かめて直す)→ ④ そのほか。
// 外への問い合わせは「この店名で探す」ボタン(プラスコードの時は「プラスコードから場所を決める」)を押した時だけ(geocode.js の決まり)。
// Googleのページを開いて読むことはしない。
import { parsePaste } from './wish-parse.js';
import { searchPlaces, ATTRIBUTION } from './geocode.js';
import { recoverNearest, decode } from './olc.js';
import { checkWish, GENRES, provisionalName } from './wish-check.js';
import { distanceM } from './michi-layer.js';

const STORAGE_KEY = 'wishLayer';
const FIXED_RECOMMENDERS = ['長男', '次男', '番組'];
const DUPLICATE_M = 100; // この距離以内で名前が似ていれば、二重登録かもしれないと知らせる
const GOOGLE_MAPS_RE = /^https?:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;

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
const normName = (s) => (s || '').normalize('NFKC').replace(/[\s・()【】「」]/g, '').toLowerCase();

const SOURCE_TEXT = {
  plus_code: '場所: プラスコードから',
  url: '場所: Googleマップのアドレスから',
  search: '場所: 位置はおおよそ(検索から)。ピンを動かして直せます',
  map: '場所: 地図で置いた場所',
};

// Googleマップで開く: 元のリンクがGoogleマップの物ならそれ、なければ店名と住所で探す(仮の名前の時は場所で探す)
export function googleMapsUrlForWish(w) {
  if (w.sourceUrl && GOOGLE_MAPS_RE.test(w.sourceUrl)) return w.sourceUrl;
  const query = w.provisional && w.lat != null ? `${w.lat},${w.lng}` : [w.name, w.address].filter(Boolean).join(' ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function readEnabled() {
  try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { return true; }
}
function writeEnabled(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* 覚えられなくても動く */ }
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
  let miniMarker = null;

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

  function popup(w) {
    const box = el('div', 'wish-popup');
    box.dataset.id = w.id;
    box.append(nameLine(w, 'wish-name', '行きたい: '));
    if (w.provisional) box.append(el('p', 'wish-sub warn', '仮の名前です。店名が分かったら「直す」で入れてください'));
    if (w.genre) box.append(el('p', 'wish-sub', `ジャンル: ${w.genre}`));
    if (w.recommenders.length) box.append(el('p', 'wish-recs', `おすすめ: ${w.recommenders.join('・')}`));
    if (w.memo) box.append(el('p', 'wish-memo', w.memo));
    if (w.address) box.append(el('p', 'wish-sub', w.address));
    if (w.positionSource === 'search') box.append(el('p', 'wish-sub warn', '位置はおおよそ(検索から)'));
    if (w.positionSource === 'plus_code') box.append(el('p', 'wish-sub', '場所: プラスコードから'));
    if (w.private) box.append(el('p', 'wish-sub', '🔒 自分だけのメモ(家族には見えません)'));
    if (w.visitedOn) box.append(el('p', 'wish-visited', `✓ 行った(${w.visitedOn.replace(/-/g, '/')})`));
    const a = el('a', 'gmap-btn', 'Googleマップで開く');
    a.href = googleMapsUrlForWish(w);
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a);
    if (w.sourceUrl && !GOOGLE_MAPS_RE.test(w.sourceUrl)) {
      const s = el('a', 'wish-source', '元のリンクを開く');
      s.href = w.sourceUrl;
      s.target = '_blank';
      s.rel = 'noopener';
      box.append(s);
    }
    if (w.mine) {
      if (!w.visitedOn && w.lat != null) box.append(btn('btn main wide wish-go', '行った(記録する)', () => startRecordFromWish(w)));
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
      if (w.lat == null) continue;
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

  function renderSearchButton() {
    $('wish-search').textContent = plusPending() ? 'プラスコードから場所を決める' : 'この店名で探す';
  }

  // スマホ(指で触る画面)では、追加画面の小さな地図を「1本指のなぞり=画面のスクロール」「2本指=地図を動かす・拡大縮小」にする。
  // 画面のスクロールと地図の取り合いを防ぐため。ピンは1本指で動かせる(印の上だけは地図より先にピンが受け取る)。
  const touchMode = (navigator.maxTouchPoints || 0) > 0 || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const HINT_KEY = 'miniTwoFingerUsed';
  const HINT_ENOUGH = 3; // 2本指で3回動かしたら、案内を出さない

  function readHintCount() {
    try { return Number(localStorage.getItem(HINT_KEY)) || 0; } catch { return 0; }
  }

  function ensureMini() {
    if (mini) return;
    mini = L.map('wish-minimap', {
      zoomControl: true,
      attributionControl: true,
      dragging: !touchMode, // 指の時は1本指で地図を動かさない(2本指は touchZoom が動かす)
      touchZoom: true,      // 2本指で動かす・拡大縮小(2本の指の真ん中に合わせて動く)
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mini);
    // 長押しで置く
    mini.on('contextmenu', (e) => setPlace(e.latlng.lat, e.latlng.lng, 'map'));
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

  function renderPlace() {
    const has = edit.lat != null;
    $('wish-place-status').textContent = has ? SOURCE_TEXT[edit.positionSource] : '場所: まだ決まっていません(「この店名で探す」か、地図で置いてください)';
    $('wish-place-status').className = `wish-place-status${has ? '' : ' none'}`;
    renderSearchButton();
    if (!mini) return;
    if (has) {
      if (!miniMarker) {
        miniMarker = L.marker([edit.lat, edit.lng], {
          draggable: true,
          icon: L.divIcon({ className: '', html: '<div class="wish-mark editing"><span>行</span></div>', iconSize: [40, 46], iconAnchor: [20, 44] }),
        }).addTo(mini);
        miniMarker.on('dragend', () => {
          const ll = miniMarker.getLatLng();
          setPlace(ll.lat, ll.lng, 'map');
        });
      } else {
        miniMarker.setLatLng([edit.lat, edit.lng]);
      }
      mini.setView([edit.lat, edit.lng], Math.max(mini.getZoom() || 0, 16), { animate: false });
    } else if (miniMarker) {
      mini.removeLayer(miniMarker);
      miniMarker = null;
    }
  }

  function setPlace(lat, lng, source) {
    edit.lat = lat;
    edit.lng = lng;
    edit.positionSource = source;
    edit.dupConfirmed = false;
    renderPlace();
  }

  function openSheet(w = null) {
    map.closePopup();
    edit = {
      id: w?.id || null,
      lat: w?.lat ?? null, lng: w?.lng ?? null, positionSource: w?.positionSource ?? null,
      plusCode: null, recs: new Set(w?.recommenders || []), genre: w?.genre || null,
      provisionalName: w?.provisional ? w.name : null, dupConfirmed: false, wide: false,
    };
    $('wish-sheet-title').textContent = w ? '行きたい店を直す' : '行きたい店を追加';
    $('wish-paste').value = '';
    $('wish-paste-msg').textContent = '';
    $('wish-search-msg').textContent = '';
    // 仮の名前の時は、店名の欄を空にして入れやすくする(空のまま保存すれば仮の名前のまま)
    $('wish-name').value = w && !w.provisional ? w.name : '';
    $('wish-name').placeholder = w?.provisional ? `${w.name} のまま(店名が分かったら入れる)` : '例: 中国料理 揚子江';
    $('wish-address').value = w?.address || '';
    $('wish-candidates').replaceChildren();
    $('wish-wider').hidden = true;
    $('wish-url').value = w?.sourceUrl || '';
    $('wish-memo').value = w?.memo || '';
    $('wish-private').checked = !!w?.private;
    $('wish-rec-free').value = '';
    $('wish-warn').textContent = '';
    $('wish-error').textContent = '';
    $('wish-paste-area').hidden = !!w;
    renderRecs();
    renderGenres();
    $('bottom-bar').hidden = true;
    $('wish-sheet').hidden = false;
    ensureMini();
    // 小さな地図は、画面が出てから大きさを測り直す
    setTimeout(() => {
      mini.invalidateSize();
      if (edit.lat == null) mini.setView(map.getCenter(), Math.max(map.getZoom(), 13), { animate: false });
      renderPlace();
    }, 0);
    renderPlace();
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
    if (r.address && !$('wish-address').value) $('wish-address').value = r.address;
    if (r.sourceUrl) $('wish-url').value = r.sourceUrl;
    edit.plusCode = r.plusCode;
    if (r.position) setPlace(r.position.lat, r.position.lng, r.positionSource);
    renderSearchButton();
  }

  $('wish-read').addEventListener('click', readPaste);
  $('wish-paste').addEventListener('paste', () => setTimeout(readPaste, 0)); // 貼ったらすぐ読み取る(端末の中だけ)

  // 今見ている地図(大きな地図)を、近い順の基準と探す範囲にする
  function nearHere() {
    const c = map.getCenter();
    const b = map.getBounds().pad(0.5); // 見ている範囲より少し広く
    return { lat: c.lat, lng: c.lng, bounds: { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() } };
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
        $('wish-search-msg').textContent = '場所を決めました(位置はおおよそ)。下の地図でピンを動かして直せます。';
      });
      return li;
    }));
  }

  async function runSearch(wide) {
    const searchBtn = $('wish-search');
    if (searchBtn.disabled) return;
    $('wish-candidates').replaceChildren();
    const near = nearHere();
    const name = $('wish-name').value.trim();
    const address = $('wish-address').value.trim();
    // プラスコードの短い形: 地域名を1回だけ位置に直し、それを基準に完全な形に戻す
    if (plusPending()) {
      const area = edit.plusCode.locality;
      if (!area) {
        $('wish-search-msg').textContent = 'プラスコードの地域名が分かりません。地図で近くを動かして選んでください。';
        return;
      }
      searchBtn.disabled = true;
      try {
        const found = await searchPlaces(area, { prefer: 'area' });
        if (!found.length) {
          $('wish-search-msg').textContent = `「${area}」が見つかりませんでした。地図で近くを動かして選んでください。`;
          return;
        }
        const full = recoverNearest(edit.plusCode.code, found[0].lat, found[0].lng);
        const d = decode(full);
        edit.plusCode = { ...edit.plusCode, full: true, code: full };
        setPlace(d.lat, d.lng, 'plus_code');
        $('wish-search-msg').textContent = `プラスコード(${full})から場所を決めました。ずれていたら、下の地図でピンを動かして直してください。`;
      } catch (e) {
        $('wish-search-msg').textContent = e.message;
      } finally {
        searchBtn.disabled = false;
      }
      return;
    }
    if (!name && !address) {
      $('wish-search-msg').textContent = '店名を入れてから「この店名で探す」を押してください。';
      return;
    }
    searchBtn.disabled = true;
    $('wish-wider').disabled = true;
    searchBtn.textContent = '探しています…';
    try {
      let results = name ? await searchPlaces(name, { near, wide }) : [];
      if (!results.length && address) results = await searchPlaces(address, { near, wide });
      if (!results.length) {
        $('wish-search-msg').textContent = wide
          ? '見つかりませんでした。店名を少し変えるか、下の地図でピンを置いてください。'
          : 'この辺りには見つかりませんでした。「もっと遠くも探す」を押すか、下の地図でピンを置いてください。';
        $('wish-wider').hidden = wide;
        return;
      }
      $('wish-search-msg').textContent = `今の地図に近い順の候補です(最大5件)。合う物を選んでください。${wide ? '' : '見つからなければ「もっと遠くも探す」。'}`;
      showCandidates(results);
      $('wish-wider').hidden = wide;
    } catch (e) {
      $('wish-search-msg').textContent = e.message;
    } finally {
      searchBtn.disabled = false;
      $('wish-wider').disabled = false;
      renderSearchButton();
    }
  }

  $('wish-search').addEventListener('click', () => runSearch(false));
  $('wish-wider').addEventListener('click', () => runSearch(true));
  $('wish-search-attrib').textContent = `検索の出典: ${ATTRIBUTION.gsi} / ${ATTRIBUTION.osm}`;
  $('wish-center-btn').addEventListener('click', () => {
    const c = mini.getCenter();
    setPlace(c.lat, c.lng, 'map');
  });

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
      address: $('wish-address').value.trim(),
      memo: $('wish-memo').value.trim(),
      sourceUrl: $('wish-url').value.trim() || null,
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
    $('wish-save').disabled = true;
    $('wish-error').textContent = '';
    try {
      if (edit.id) await store.updateWish(edit.id, w);
      else await store.addWish(w);
      closeSheet();
      showToast(w.lat == null ? '保存しました(場所が決まっていないので、地図には出ません)' : provisional ? `「${name}」で保存しました。店名が分かったら「直す」で入れてください` : '行きたい店に保存しました');
    } catch (e) {
      $('wish-error').textContent = e.message;
    } finally {
      $('wish-save').disabled = false;
    }
  });
  $('wish-cancel').addEventListener('click', closeSheet);
  $('wish-add-btn').addEventListener('click', () => openSheet());

  // ===== 一覧(おすすめした人で絞り込み) =====
  function renderList() {
    const sheet = $('wish-list-sheet');
    const head = el('div', 'picker-head');
    head.append(el('h2', 'sheet-title', '行きたい店の一覧'), btn('btn sub picker-close', '閉じる', () => { sheet.hidden = true; $('bottom-bar').hidden = false; }));
    const people = [...new Set(wishes.flatMap((w) => w.recommenders))];
    const tabs = el('div', 'picker-tabs wrap');
    for (const p of [null, ...people]) {
      const b = btn(`picker-tab${listFilter === p ? ' active' : ''}`, p ? `${p}おすすめ` : 'すべて', () => { listFilter = p; renderList(); });
      b.dataset.filter = p || '';
      tabs.append(b);
    }
    const shown = wishes.filter((w) => !listFilter || w.recommenders.includes(listFilter));
    const ul = el('ul', 'picker-list');
    for (const w of shown) {
      const li = el('li', 'picker-item wish-item');
      li.dataset.id = w.id;
      const body = el('span', 'picker-body');
      const title = el('span', 'picker-name', `${w.visitedOn ? '✓ ' : ''}${w.private ? '🔒 ' : ''}${w.name}`);
      if (w.provisional) title.append(' ', el('span', 'wish-provisional', '仮'));
      body.append(title, el('span', 'picker-sub', [w.recommenders.length ? `おすすめ: ${w.recommenders.join('・')}` : '', w.memo].filter(Boolean).join(' / ') || (w.address || '')));
      const a = el('a', 'wish-gmap', 'Googleマップ');
      a.href = googleMapsUrlForWish(w);
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => e.stopPropagation());
      li.append(el('span', `picker-mark wish${w.visitedOn ? ' visited' : ''}`, w.visitedOn ? '✓' : '行'), body, a);
      li.addEventListener('click', () => {
        sheet.hidden = true;
        $('bottom-bar').hidden = false;
        if (w.lat == null) { showToast('この店は場所がまだ決まっていません。「直す」から場所を決めてください'); if (w.mine) openSheet(w); return; }
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
    refresh, markVisited, openSheet,
    wishes: () => wishes, isEnabled: () => enabled, markerIds: () => [...markers.keys()],
    miniMap: () => mini, miniMarkerLatLng: () => miniMarker?.getLatLng() ?? null, miniTouchMode: () => touchMode,
  };
}
