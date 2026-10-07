// 見本の保存先(PCでの試験用。アドレスに ?mock=1)。本物(backend-supabase.js)と同じ名前の関数を持ち、
// 同じ決まり(持ち主か共有ONだけ見える・写真も同じ)をまねる。
// 記録は本物の表と同じ形(owner_id, photo_path …)で持ち、record-shape.js の同じ変換を通して返す。
// 写真の読み出しも本物と同じく、画面から渡された「写真の場所」を使う。
// 試験用: アドレスに ?me=wife / ?me=son を付けると、その人としてログインしたことになる。
//         「圏外のふり」は store.js の setFakeOffline で切り替える。

import * as db from './db.js';
import { SAMPLE_PINS } from './sample-data.js';
import { rowToRecord, noteRowToObj, gourmetRowToObj, tvRowToObj, visitRowToObj } from './record-shape.js';
import { checkGourmetList, checkLocalPick, checkTv, checkVisit } from './station-notes.js';

export class NetworkError extends Error {}

const MEMBERS = [
  { id: 'husband', role: 'husband', name: '夫' },
  { id: 'wife', role: 'wife', name: '妻' },
  { id: 'son', role: 'son', name: '長男' },
];

const requested = new URLSearchParams(location.search).get('me');
const ME = MEMBERS.find((m) => m.id === requested) || MEMBERS[0];

let fakeOffline = false;
export function setFakeOffline(value) { fakeOffline = value; }
export function isFakeOffline() { return fakeOffline; }

function ensureOnline() {
  if (fakeOffline || !navigator.onLine) throw new NetworkError('電波がありません');
}

// 見本ではログイン画面を出さず、アドレスで選んだ人として始める
export const needsLogin = false;
export async function init() { return { ...ME }; }
export async function signIn() { return { ...ME }; }
export async function signOut() {}

export function me() {
  return { ...ME };
}

export function members() {
  return MEMBERS.map((m) => ({ ...m }));
}

let seeded;
function seed() {
  if (!seeded) {
    seeded = (async () => {
      if ((await db.count('mock_pins')) > 0) return;
      for (const p of SAMPLE_PINS) {
        const path = `${p.recorder}/${p.id}.svg`;
        const svg = await (await fetch(p.photoUrl)).arrayBuffer();
        await db.put('mock_photos', { path, data: svg, type: 'image/svg+xml' });
        await db.put('mock_pins', {
          id: p.id, owner_id: p.recorder, lat: p.lat, lng: p.lng, photo_path: path,
          memo: p.memo, stars: p.stars, shared: p.shared, recorded_at: p.createdAt, created_at: p.createdAt,
        });
        for (const [i, r] of p.reactions.entries()) {
          await db.put('mock_reactions', {
            id: `${p.id}-r${i}`, pin_id: p.id, author_id: r.by, memo: r.memo, stars: r.stars, created_at: p.createdAt,
          });
        }
      }
    })();
  }
  return seeded;
}

// 本物の決まり(setup.sql)と同じ: 持ち主か共有ON
const canSee = (row) => row.owner_id === ME.id || row.shared;

export async function listPins() {
  ensureOnline();
  await seed();
  const rows = (await db.getAll('mock_pins')).filter(canSee);
  const visibleIds = new Set(rows.map((r) => r.id));
  const reactions = (await db.getAll('mock_reactions')).filter((r) => visibleIds.has(r.pin_id));
  return rows
    .map((row) => rowToRecord({ ...row, reactions: reactions.filter((r) => r.pin_id === row.id) }))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

// 本物と同じく、画面から渡された写真の場所で読み出す。
// 見てよいかは本物の写真置き場の決まりと同じ: 自分のフォルダ、または共有ONの記録の写真
export async function fetchPhoto(pin) {
  if (!pin.photoPath) throw new Error('写真がありません');
  ensureOnline();
  const ownFolder = pin.photoPath.startsWith(`${ME.id}/`);
  const owner = (await db.getAll('mock_pins')).find((r) => r.photo_path === pin.photoPath);
  if (!ownFolder && !(owner && canSee(owner))) throw new Error('この写真は見られません');
  const photo = await db.get('mock_photos', pin.photoPath);
  if (!photo) throw new Error('この写真は見られません');
  return URL.createObjectURL(new Blob([photo.data], { type: photo.type }));
}

export async function uploadPhoto(path, data, type) {
  ensureOnline();
  if (!path.startsWith(`${ME.id}/`)) throw new Error('自分のフォルダにしか写真を置けません');
  await db.put('mock_photos', { path, data, type });
}

// 同じ id で何度送っても1件だけ(圏外からの送り直し対策)
export async function insertPin(pin) {
  ensureOnline();
  await seed();
  if (await db.get('mock_pins', pin.id)) return;
  if (pin.photoPath && !pin.photoPath.startsWith(`${ME.id}/`)) throw new Error('記録を送れませんでした: 写真の場所が自分のフォルダではありません');
  await db.put('mock_pins', {
    id: pin.id, owner_id: ME.id, lat: pin.lat, lng: pin.lng, photo_path: pin.photoPath ?? null,
    memo: pin.memo || '', stars: pin.stars ?? null,
    shared: ME.role !== 'son', // 本物では保存先が決める(長男は見せないで始める)
    recorded_at: pin.recordedAt, created_at: new Date().toISOString(),
  });
}

// 試験用: 写真が消せない状態をまねる
let failPhotoDelete = false;
export function setFailPhotoDelete(value) { failPhotoDelete = value; }

// 自分の記録を消す(本物と同じ順番: 写真 → 記録。写真が消せなければ記録は残す。付いた一言・星も消える)
export async function deletePin(pin) {
  ensureOnline();
  const row = await db.get('mock_pins', pin.id);
  if (!row || row.owner_id !== ME.id) throw new Error('記録を消せませんでした(自分の記録だけ消せます)');
  for (const path of [row.photo_path, row.thumb_path].filter(Boolean)) {
    if (!path.startsWith(`${ME.id}/`)) throw new Error('自分の写真だけ消せます');
    if (failPhotoDelete) throw new Error('写真を消せませんでした。記録は消していません');
    await db.del('mock_photos', path);
  }
  for (const r of (await db.getAll('mock_reactions')).filter((r) => r.pin_id === pin.id)) await db.del('mock_reactions', r.id);
  await db.del('mock_pins', pin.id);
}

async function ownPin(id) {
  const row = await db.get('mock_pins', id);
  if (!row || row.owner_id !== ME.id) throw new Error('自分の記録だけ変更できます');
  return row;
}

export async function setShared(id, shared) {
  ensureOnline();
  const row = await ownPin(id);
  await db.put('mock_pins', { ...row, shared });
}

export async function updatePin(id, { memo, stars }) {
  ensureOnline();
  const row = await ownPin(id);
  await db.put('mock_pins', { ...row, memo, stars });
}

export async function addReaction({ id, pinId, memo, stars }) {
  ensureOnline();
  if (await db.get('mock_reactions', id)) return;
  const row = await db.get('mock_pins', pinId);
  if (!row || !canSee(row)) throw new Error('この記録には一言を付けられません');
  await db.put('mock_reactions', { id, pin_id: pinId, author_id: ME.id, memo: memo || '', stars: stars ?? null, created_at: new Date().toISOString() });
}

// 試験用: 本物の表と同じ形の行を、そのまま見本の保存先に入れる(見本と本物の形の比較試験で使う)
export async function putRowsForTest(rows) {
  await seed();
  for (const row of rows) {
    const { reactions = [], ...pin } = row;
    await db.put('mock_pins', pin);
    for (const r of reactions) await db.put('mock_reactions', r);
  }
}

// ===== 駅のメモ(見本)。本物の決まりと同じ: 見るのは家族、書くのは駅メモ係(見本では夫)だけ =====
export async function isStationEditor() {
  return ME.id === 'husband';
}

function ensureEditor() {
  if (ME.id !== 'husband') throw new Error('駅のメモを書けるのは駅メモ係だけです');
}

export async function listStationData() {
  ensureOnline();
  return {
    notes: (await db.getAll('mock_station_notes')).map(noteRowToObj),
    gourmet: (await db.getAll('mock_station_gourmet')).map(gourmetRowToObj).sort((a, b) => a.rank - b.rank),
    tv: (await db.getAll('mock_station_tv')).map(tvRowToObj).sort((a, b) => b.airedOn.localeCompare(a.airedOn)),
  };
}

export async function saveStationNote(n) {
  ensureOnline();
  ensureEditor();
  const err = checkLocalPick(n);
  if (err) throw new Error(err);
  await db.put('mock_station_notes', {
    station_id: n.stationId, station_name: n.stationName,
    local_pick: n.localPick || null, local_pick_from: n.localPick ? n.localPickFrom : null, local_pick_on: n.localPick ? n.localPickOn : null,
    updated_by: ME.id, updated_at: new Date().toISOString(),
  });
}

// その駅のグルメトップ3を、渡した内容に置き換える(駅メモの行が先に必要)
export async function replaceGourmet(stationId, items) {
  ensureOnline();
  ensureEditor();
  const err = checkGourmetList(items);
  if (err) throw new Error(err);
  if (!(await db.get('mock_station_notes', stationId))) throw new Error('先に駅のメモを保存してください');
  for (const g of (await db.getAll('mock_station_gourmet')).filter((g) => g.station_id === stationId)) await db.del('mock_station_gourmet', g.id);
  for (const g of items) {
    await db.put('mock_station_gourmet', {
      id: g.id || crypto.randomUUID(), station_id: stationId, rank: g.rank, dish: g.dish, shop: g.shop,
      confirmed_on: g.confirmedOn, source_url: g.sourceUrl, confirmed_by: ME.id, created_at: new Date().toISOString(),
    });
  }
}

export async function addTv(t) {
  ensureOnline();
  ensureEditor();
  const err = checkTv(t);
  if (err) throw new Error(err);
  if (!(await db.get('mock_station_notes', t.stationId))) throw new Error('先に駅のメモを保存してください');
  await db.put('mock_station_tv', {
    id: t.id || crypto.randomUUID(), station_id: t.stationId, program: t.program, aired_on: t.airedOn,
    source_url: t.sourceUrl, note: t.note || '', created_by: ME.id, created_at: new Date().toISOString(),
  });
}

export async function deleteTv(id) {
  ensureOnline();
  ensureEditor();
  await db.del('mock_station_tv', id);
}

// ===== 手で付ける「行った」(見本)。本人だけが見られ、本人だけが付け外しできる =====
export async function listManualVisits() {
  ensureOnline();
  return (await db.getAll('mock_station_visits')).filter((v) => v.user_id === ME.id).map(visitRowToObj);
}

export async function addManualVisit(v) {
  ensureOnline();
  const err = checkVisit(v);
  if (err) throw new Error(err);
  const all = await db.getAll('mock_station_visits');
  if (all.some((x) => x.id === v.id)) return; // 送り直し
  if (all.some((x) => x.user_id === ME.id && x.station_id === v.stationId)) return; // 同じ駅は1人1件(すでにある)
  await db.put('mock_station_visits', {
    id: v.id, user_id: ME.id, station_id: v.stationId, visited_on: v.visitedOn || null, memo: v.memo || '', created_at: new Date().toISOString(),
  });
}

export async function removeManualVisit(stationId) {
  ensureOnline();
  for (const x of (await db.getAll('mock_station_visits')).filter((x) => x.user_id === ME.id && x.station_id === stationId)) {
    await db.del('mock_station_visits', x.id);
  }
}
