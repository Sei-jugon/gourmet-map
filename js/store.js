// 画面と保存先のあいだの窓口。
// 記録・一言・切り替えは、まずスマホの中の「未送信」に入れ、電波があれば順番に送る。
// 圏外でも記録でき、電波が戻ってアプリが開いている時に自動で送る(iPhoneは閉じている間は送れない)。
// 見える範囲の決まりは保存先側(supabase/setup.sql)で守る。

import * as db from './db.js';

// 保存先: ふだんは本物(Supabase)。アドレスに ?mock=1 を付けた時だけ見本(PCでの試験用)
const useMock = new URLSearchParams(location.search).get('mock') === '1';
const backend = await import(useMock ? './backend-mock.js' : './backend-supabase.js');

export const events = new EventTarget();
const changed = () => events.dispatchEvent(new Event('change'));

export const me = backend.me;
export const members = backend.members;
export const needsLogin = backend.needsLogin;
export const usingMock = useMock;

// 起動時のログイン確認。ログインしていなければ null
export const init = () => backend.init();

export async function signIn(email, password) {
  const user = await backend.signIn(email, password);
  changed();
  return user;
}

// パスワードを変える。画面で先に確かめ(長さ・2つの一致)、電波がある時だけ保存先に頼む。
// パスワードはどこにも保存しない
export const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72; // 保存先の上限(英数字なら72文字。日本語の文字は1文字で3つ分)

export async function changePassword(current, next, again) {
  if (!current) throw new Error('今のパスワードを入れてください');
  if (!next) throw new Error('新しいパスワードを入れてください');
  if (next !== again) throw new Error('新しいパスワードが2つで一致しません。同じものを2回入れてください');
  if ([...next].length < PASSWORD_MIN) throw new Error(`新しいパスワードは${PASSWORD_MIN}文字以上にしてください`);
  if (new TextEncoder().encode(next).length > PASSWORD_MAX_BYTES) throw new Error('新しいパスワードが長すぎます(英数字なら72文字まで)');
  if (next === current) throw new Error('今と同じパスワードには変えられません');
  if (backend.isFakeOffline() || !navigator.onLine) throw new backend.NetworkError('電波がある時に変えられます');
  try {
    await backend.changePassword(current, next);
  } catch (e) {
    if (e instanceof backend.NetworkError) throw new backend.NetworkError('電波がある時に変えられます');
    throw e;
  }
}

// ログアウト: スマホの中の記録の控え・未送信も消す(次に別の人が使っても見えないように)
export async function signOut() {
  await backend.signOut();
  await db.deleteEverything();
}
export const setFakeOffline = (v) => { backend.setFakeOffline(v); changed(); };
export const isFakeOffline = backend.isFakeOffline;

// 試験用: スマホの中のデータを消す
export async function resetLocalData() {
  await db.deleteEverything();
  try { localStorage.clear(); } catch { /* 消せなくても続ける */ }
}

const memberOf = (userId) => members().find((m) => m.id === userId) ?? { role: 'child', name: '家族' };

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ===== 未送信 =====

async function enqueue(type, payload) {
  await db.add('outbox', { type, payload, queuedAt: Date.now(), error: null });
  changed();
  sync();
}

export async function outboxStatus() {
  const ops = await db.getAll('outbox');
  return { pending: ops.filter((o) => !o.error).length, failed: ops.filter((o) => o.error) };
}

export async function retryFailed() {
  for (const op of await db.getAll('outbox')) {
    if (op.error) await db.put('outbox', { ...op, error: null });
  }
  sync();
}

async function apply(op) {
  const p = op.payload;
  switch (op.type) {
    case 'createPin': {
      const photoPath = `${me().id}/${p.id}.jpg`;
      await backend.uploadPhoto(photoPath, p.photo, p.photoType);
      await backend.insertPin({ id: p.id, lat: p.lat, lng: p.lng, photoPath, memo: p.memo, stars: p.stars, recordedAt: p.recordedAt });
      break;
    }
    case 'setShared': return backend.setShared(p.id, p.shared);
    case 'updatePin': return backend.updatePin(p.id, { memo: p.memo, stars: p.stars });
    case 'addReaction': return backend.addReaction(p);
    case 'addVisit': return backend.addManualVisit(p);
    case 'removeVisit': return backend.removeManualVisit(p.stationId);
    default: throw new Error(`不明な操作: ${op.type}`);
  }
}

let syncing = null;

// 古い順に送る。電波がなければそこで止め、次の機会に続きから送る。
// 電波以外の理由で断られたもの(権限など)は「送れなかった」として残し、画面に出す。
export function sync() {
  if (!backend.me()) return Promise.resolve(0); // ログイン前は送らない
  if (!syncing) {
    syncing = (async () => {
      let sent = 0;
      let failed = 0;
      try {
        for (const op of await db.getAll('outbox')) {
          if (op.error) continue;
          try {
            await apply(op);
            await db.del('outbox', op.seq);
            sent++;
          } catch (e) {
            if (e instanceof backend.NetworkError) break;
            await db.put('outbox', { ...op, error: e.message });
            failed++;
          }
        }
      } finally {
        syncing = null;
        if (sent > 0 || failed > 0) changed();
      }
      return sent;
    })();
  }
  return syncing;
}

// ===== 記録の一覧 =====

export async function loadPins() {
  let rows;
  let offline = false;
  try {
    rows = await backend.listPins();
    await db.replaceAll('pin_cache', rows); // 見えなくなった記録の控えはここで消える
  } catch (e) {
    if (!(e instanceof backend.NetworkError)) throw e;
    rows = await db.getAll('pin_cache');
    offline = true;
  }

  const pins = new Map(rows.map((r) => [r.id, {
    id: r.id, recorder: memberOf(r.ownerId).role, recorderName: memberOf(r.ownerId).name, mine: r.ownerId === me().id,
    lat: r.lat, lng: r.lng, photoPath: r.photoPath, memo: r.memo, stars: r.stars, shared: r.shared,
    recordedAt: r.recordedAt, pending: false, localPhoto: null,
    reactions: r.reactions.map((x) => ({ by: memberOf(x.authorId).name, memo: x.memo, stars: x.stars, pending: false })),
  }]));

  // まだ送れていない操作を重ねて表示する
  for (const op of await db.getAll('outbox')) {
    const p = op.payload;
    if (op.type === 'createPin') {
      pins.set(p.id, {
        id: p.id, recorder: me().role, recorderName: me().name, mine: true, lat: p.lat, lng: p.lng, photoPath: null,
        memo: p.memo, stars: p.stars, shared: me().role !== 'son', recordedAt: p.recordedAt,
        pending: true, failed: op.error, localPhoto: { data: p.photo, type: p.photoType }, reactions: [],
      });
    } else if (op.type === 'setShared' && pins.has(p.id)) {
      pins.get(p.id).shared = p.shared;
    } else if (op.type === 'updatePin' && pins.has(p.id)) {
      Object.assign(pins.get(p.id), { memo: p.memo, stars: p.stars });
    } else if (op.type === 'addReaction' && pins.has(p.pinId)) {
      pins.get(p.pinId).reactions.push({ by: me().name, memo: p.memo, stars: p.stars, pending: true });
    }
  }
  return { pins: [...pins.values()], offline };
}

export async function photoUrl(pin) {
  if (pin.localPhoto) return URL.createObjectURL(new Blob([pin.localPhoto.data], { type: pin.localPhoto.type }));
  return backend.fetchPhoto(pin);
}

// ===== 書き込み(すべて未送信を経由) =====

export async function createRecord({ lat, lng, photoBlob, memo, stars, recordedAt }) {
  const id = crypto.randomUUID();
  await enqueue('createPin', {
    id, lat, lng, memo: memo || '', stars: stars ?? null,
    recordedAt: recordedAt || new Date().toISOString(),
    photo: await photoBlob.arrayBuffer(), photoType: photoBlob.type,
  });
  return id;
}

// ===== 自分の記録を消す =====
// - まだ送れていない記録(未送信): スマホの中の控え(未送信の操作)を消すだけ。
// - 送った記録: 電波がある時だけ消せる(圏外では受け付けない。未送信と混ざる複雑さを避けるため)。
//   その記録に向けた、まだ送れていない操作(見せる/見せない・一言など)も一緒に消す。
const opTargetsPin = (op, pinId) => op.payload.id === pinId || op.payload.pinId === pinId;

export async function deleteRecord(pin) {
  if (!pin.mine) throw new Error('自分の記録だけ消せます');
  if (!pin.pending) {
    if (backend.isFakeOffline() || !navigator.onLine) throw new backend.NetworkError('電波がある時に消せます');
    try {
      await backend.deletePin(pin);
    } catch (e) {
      if (e instanceof backend.NetworkError) throw new backend.NetworkError('電波がある時に消せます');
      throw e;
    }
  }
  for (const op of await db.getAll('outbox')) {
    if (opTargetsPin(op, pin.id)) await db.del('outbox', op.seq);
  }
  changed();
}

export const setShared = (id, shared) => enqueue('setShared', { id, shared });
export const updatePin = (id, memo, stars) => enqueue('updatePin', { id, memo, stars });
export const addReaction = (pinId, memo, stars) =>
  enqueue('addReaction', { id: crypto.randomUUID(), pinId, memo, stars });

// ===== 手で付ける「行った」(昔の分。本人だけ) =====
// 記録と同じく、まず未送信に入れて電波があれば送る(圏外でも付けられる)

const VISITS_KEY = 'manualVisitsCache';

export async function loadManualVisits() {
  let visits;
  try {
    visits = await backend.listManualVisits();
    try { localStorage.setItem(VISITS_KEY, JSON.stringify(visits)); } catch { /* 控えられなくても続ける */ }
  } catch (e) {
    if (!(e instanceof backend.NetworkError)) throw e;
    try { visits = JSON.parse(localStorage.getItem(VISITS_KEY)) || []; } catch { visits = []; }
  }
  const byStation = new Map(visits.map((v) => [v.stationId, v]));
  for (const op of await db.getAll('outbox')) {
    if (op.type === 'addVisit') byStation.set(op.payload.stationId, { ...op.payload, pending: true });
    if (op.type === 'removeVisit') byStation.delete(op.payload.stationId);
  }
  return [...byStation.values()];
}

export const addManualVisit = (stationId, visitedOn) =>
  enqueue('addVisit', { id: crypto.randomUUID(), stationId, visitedOn: visitedOn || null, memo: '' });
export const removeManualVisit = (stationId) => enqueue('removeVisit', { stationId });

// ===== 駅のメモ(グルメトップ3・地元の一押し・TVで紹介) =====
// 見るのは家族。書くのは駅メモ係だけ。書く時は電波が必要(家で落ち着いて入れる前提)

const NOTES_KEY = 'stationNotesCache';
let editorCache = null;

export async function loadStationData() {
  try {
    const data = await backend.listStationData();
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(data)); } catch { /* 控えられなくても続ける */ }
    return data;
  } catch (e) {
    if (!(e instanceof backend.NetworkError)) throw e;
    try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || { notes: [], gourmet: [], tv: [] }; } catch { return { notes: [], gourmet: [], tv: [] }; }
  }
}

export async function isStationEditor() {
  if (editorCache === null) editorCache = await backend.isStationEditor();
  return editorCache;
}

// 1つの駅のメモをまとめて保存する(駅の行 → グルメ → TVの追加・削除の順)
export async function saveStationMemo({ note, gourmet, tvAdd, tvDelete }) {
  await backend.saveStationNote(note);
  await backend.replaceGourmet(note.stationId, gourmet);
  for (const id of tvDelete) await backend.deleteTv(id);
  for (const t of tvAdd) await backend.addTv({ ...t, stationId: note.stationId });
  changed();
}
