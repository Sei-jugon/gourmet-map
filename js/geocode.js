// 店名・住所・地域名から、場所の候補を出す(行きたい店の追加・プラスコードの地域名)。
// 守る決まり:
//  - 呼ぶのは「検索」ボタンを押した時だけ(入力中の自動検索はしない)。この部品は、画面のボタンからだけ呼ぶ
//  - Nominatim は1秒に1回まで(続けて押しても、前の問い合わせから1秒あくまで待つ。同時には1つだけ)
//  - 同じ検索語の結果は覚えて使い回す(開いている間)
//  - 住所らしい言葉は国土地理院を先に、店名は Nominatim を先に使う。APIキーが要る物は使わない
//  - 出典(国土地理院 / © OpenStreetMap contributors)は画面に出す
//  - サービスの場所・使う/使わないは data/services.json で替えられる(Nominatim の利用ルール: いつでも替えられること)
//  - 候補は、今見ている地図の近くを優先し、近い順に最大5件(Nominatim は範囲の指定 viewbox で、その範囲の中だけを探す)。
//    「もっと遠くも探す」の時だけ範囲を外す(それでも近い順・最大5件)
//  - うまくいかない時(エラー・10秒の時間切れ・つながらない・止めている)は、画面を止めずに
//    「うまく探せませんでした。時間をおくか、地図でピンを置いてください」を出す(SearchFailed)
//  - 住所の検索で国土地理院が失敗したら、Nominatim に切り替える(1秒に1回の決まりは守る)
//  - 429(多すぎ)か403(断られた)を受けたサービスは、10分間は呼ばない(止められる前に引く)

const PREF_RE = /(北海道|東京都|京都府|大阪府|.{2,3}県)/;

export const FAIL_MESSAGE = 'うまく探せませんでした。時間をおくか、地図でピンを置いてください';
export class SearchFailed extends Error {
  constructor() { super(FAIL_MESSAGE); this.name = 'SearchFailed'; }
}
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_REST_MS = 10 * 60 * 1000;

let config = null;
async function loadConfig() {
  if (!config) {
    try {
      const res = await fetch('data/services.json', { cache: 'no-cache' });
      config = res.ok ? await res.json() : null;
    } catch { config = null; }
    config = config || { gsi: { enabled: false }, nominatim: { enabled: false } };
  }
  return config;
}

// 試験用: 外へ問い合わせる関数を差し替える・回数を数える
let fetchImpl = (...args) => fetch(...args);
let now = () => Date.now();
export function setFetchForTest(fn) { fetchImpl = fn; }
export function setClockForTest(fn) { now = fn || (() => Date.now()); }
export function setConfigForTest(cfg) { config = cfg; }
export const stats = { gsi: 0, nominatim: 0, cacheHits: 0 };
export function resetForTest() {
  cache.clear();
  stats.gsi = 0; stats.nominatim = 0; stats.cacheHits = 0;
  lastNominatimAt = 0;
  config = null;
  restUntil.gsi = 0; restUntil.nominatim = 0;
  saveRest();
  now = () => Date.now();
}

// 429・403 を受けたサービスの「休み」(開き直しても守るよう、端末に覚える)
const REST_KEY = 'searchRest';
const restUntil = { gsi: 0, nominatim: 0 };
try { Object.assign(restUntil, JSON.parse(localStorage.getItem(REST_KEY) || '{}')); } catch { /* 覚えていなくても動く */ }
function saveRest() {
  try { localStorage.setItem(REST_KEY, JSON.stringify(restUntil)); } catch { /* 覚えられなくても動く */ }
}
export function restingUntil(name) { return restUntil[name] > now() ? restUntil[name] : 0; }

// 1つのサービスに問い合わせる。うまくいかなければ null(理由は投げない。呼ぶ側が切り替え・案内を決める)
async function ask(name, url, cfg) {
  const svc = cfg[name];
  if (!svc?.enabled || restingUntil(name)) return null;
  stats[name]++;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), svc.timeout_ms ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await Promise.race([
      fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), (svc.timeout_ms ?? DEFAULT_TIMEOUT_MS) + 50)),
    ]);
    if (res.status === 429 || res.status === 403) {
      restUntil[name] = now() + (svc.rest_on_block_ms ?? DEFAULT_REST_MS);
      saveRest();
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return null; // 時間切れ・つながらない・答えが読めない
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map();
let lastNominatimAt = 0;
let nominatimChain = Promise.resolve();

export function looksLikeAddress(q) {
  return PREF_RE.test(q) || /[市区町村郡]/.test(q) && /\d|丁目|番地?/.test(q) || /^〒?\s*\d{3}-?\d{4}/.test(q);
}

export const MAX_CANDIDATES = 5;

function distKm(a, b) {
  const dy = (a.lat - b.lat) * 111.32;
  const dx = (a.lng - b.lng) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(dx, dy);
}

// 近い順に並べて最大5件。基準があれば「ここから約○km」用に距離を付ける
function rank(results, near) {
  const withDist = results.map((r) => ({ ...r, km: near ? distKm(r, near) : null }));
  if (near) withDist.sort((a, b) => a.km - b.km);
  return withDist.slice(0, MAX_CANDIDATES);
}

// 答えは配列、うまくいかなければ null
async function gsiSearch(q, cfg) {
  const data = await ask('gsi', `${cfg.gsi?.url}?q=${encodeURIComponent(q)}`, cfg);
  if (!data) return null;
  return data.slice(0, 5).map((f) => ({
    label: f.properties?.title || q,
    lat: Number(f.geometry?.coordinates?.[1]),
    lng: Number(f.geometry?.coordinates?.[0]),
    source: 'gsi',
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

// Nominatim は順番待ちの列に並べて、前の問い合わせから min_interval_ms あける
function nominatimSearch(q, cfg, area) {
  if (!cfg.nominatim?.enabled || restingUntil('nominatim')) return Promise.resolve(null);
  const run = async () => {
    if (restingUntil('nominatim')) return null; // 待っている間に休みに入った
    const gap = (cfg.nominatim.min_interval_ms ?? 1000) - (Date.now() - lastNominatimAt);
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    lastNominatimAt = Date.now();
    // area があれば、その範囲の中だけを探す(viewbox=西,北,東,南 と bounded=1)
    const box = area ? `&viewbox=${area.w},${area.n},${area.e},${area.s}&bounded=1` : '';
    const url = `${cfg.nominatim.url}?format=jsonv2&countrycodes=jp&accept-language=ja&limit=10${box}&q=${encodeURIComponent(q)}`;
    const data = await ask('nominatim', url, cfg);
    lastNominatimAt = Date.now(); // 答えが来た時からも1秒あける
    if (!data) return null;
    return data.map((r) => ({
      label: r.display_name || r.name || q,
      lat: Number(r.lat),
      lng: Number(r.lon),
      source: 'osm',
    })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  };
  const p = nominatimChain.then(run, run).catch(() => null);
  nominatimChain = p;
  return p;
}

// prefer: 'auto'(住所らしければ国土地理院から)/'area'(地域名。国土地理院から)
// near: { lat, lng, bounds: { s, w, n, e } } … 今見ている地図(近い順の基準と、探す範囲)
// wide: true の時は範囲を外して全国から探す(それでも近い順・最大5件)
export async function searchPlaces(query, { prefer = 'auto', near = null, wide = false } = {}) {
  const q = (query || '').trim();
  if (!q) return [];
  if (!navigator.onLine) throw new Error('電波がある時に検索できます');
  const r2 = (x) => Math.round(x * 100) / 100;
  const area = near && near.bounds && !wide ? { s: r2(near.bounds.s), w: r2(near.bounds.w), n: r2(near.bounds.n), e: r2(near.bounds.e) } : null;
  const key = `${prefer}|${wide ? 'wide' : area ? `${area.s},${area.w},${area.n},${area.e}` : 'all'}|${q}`;
  if (cache.has(key)) {
    stats.cacheHits++;
    return rank(cache.get(key), near);
  }
  const cfg = await loadConfig();
  const addressFirst = prefer === 'area' || looksLikeAddress(q);
  let results = [];
  const inArea = (r) => !area || (r.lat >= area.s && r.lat <= area.n && r.lng >= area.w && r.lng <= area.e);
  let answered = false; // どこか1つでも、ちゃんと答えた(0件でも)か
  if (addressFirst) {
    // 住所・地域名は場所が1つに決まるので、範囲で絞らない(近い順には並べる)
    // 国土地理院が失敗・0件なら Nominatim に切り替える
    const g = await gsiSearch(q, cfg);
    if (g) { answered = true; results = g; }
    if (!results.length) {
      const n = await nominatimSearch(q, cfg, prefer === 'area' ? null : area);
      if (n) { answered = true; results = n; }
    }
  } else {
    const n = await nominatimSearch(q, cfg, area);
    if (n) { answered = true; results = n; }
    if (!results.length && PREF_RE.test(q)) {
      const g = await gsiSearch(q, cfg);
      if (g) { answered = true; results = g.filter(inArea); }
    }
  }
  // どこからも答えがない(エラー・時間切れ・つながらない・休み中・止めている)時は、やさしく案内する。覚えない
  if (!answered) throw new SearchFailed();
  cache.set(key, results);
  return rank(results, near);
}

export const ATTRIBUTION = { gsi: '国土地理院', osm: '© OpenStreetMap contributors' };
