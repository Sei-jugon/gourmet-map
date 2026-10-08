// 本物の保存先(Supabase)。backend-mock.js と同じ名前の関数を持つ。
// 見える範囲の決まりは保存先側(supabase/setup.sql の行レベルセキュリティ)で守る。ここでは迂回しない。
// パスワードは保存しない。ログイン後の「通行証」(セッション)だけを、ライブラリがスマホに保存する。
//
// 写真の読み出しは、ブラウザの一時保存を使わない(cache: 'no-store' と、毎回違う文字を足したアドレス)。
// → 「見せない」にした写真が、一時保存から開けてしまうことを防ぐ(試験1回目の項目7の原因)。

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { rowToRecord, noteRowToObj, gourmetRowToObj, tvRowToObj, visitRowToObj } from './record-shape.js';
import { checkGourmetList, checkLocalPick, checkTv, checkVisit } from './station-notes.js';

const BUCKET = 'photos';

export class NetworkError extends Error {}

// supabase-js は index.html で読み込み済み(改ざん防止の確認つき)
const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'touring-gourmet-auth' },
});

const MEMBERS_KEY = 'familyMembers'; // 圏外で開いた時のための名簿の控え(名前と役割だけ)
const ME_KEY = 'familyMe';           // 同じく、ログインしている人の控え(パスワードは持たない)

let user = null;      // { id, role, name }
let memberList = [];  // [{ id, role, name }]

function readCachedMembers() {
  try { return JSON.parse(localStorage.getItem(MEMBERS_KEY)) || []; } catch { return []; }
}

function writeCachedMembers(list) {
  try { localStorage.setItem(MEMBERS_KEY, JSON.stringify(list)); } catch { /* 控えられなくても続ける */ }
}

function readCachedMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY)) || null; } catch { return null; }
}

function setUser(value) {
  user = value;
  try {
    if (value) localStorage.setItem(ME_KEY, JSON.stringify(value));
    else localStorage.removeItem(ME_KEY);
  } catch { /* 控えられなくても続ける */ }
}

// 電波がない・通信できない時の失敗かどうか(iPhoneは「Load failed」、Chromeは「Failed to fetch」)
function isNetworkFailure(error) {
  if (!navigator.onLine) return true;
  const text = `${error?.name || ''} ${error?.message || ''} ${error?.details || ''}`;
  return /Failed to fetch|Load failed|NetworkError|network|AuthRetryableFetchError|AbortError|TimeoutError|aborted/i.test(text);
}

// 電波が弱い山の中で待たされ続けないよう、1回のやり取りに時間の上限を付ける。
// 圏外とわかっている時は、通信せずにすぐ「電波がない」扱いにする(ライブラリの再試行で待たされるため)
const REQUEST_TIMEOUT_MS = 15000;
const limited = (query) => query.abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));

function ensureOnline() {
  if (!navigator.onLine) throw new NetworkError('電波がありません');
}

// 失敗を「電波がない」か「断られた」かに分けて投げる
function fail(error, deniedMessage) {
  if (isNetworkFailure(error)) throw new NetworkError('電波がありません');
  const e = new Error(deniedMessage || error?.message || '保存先でエラーが起きました');
  e.cause = error;
  throw e;
}

// 名簿を読む。圏外の時は控えを使い、fromServer=false を返す
async function loadMembers() {
  if (!navigator.onLine) return { list: readCachedMembers(), fromServer: false };
  const { data, error } = await limited(client.from('family_members').select('user_id, display_name, role'));
  if (error) {
    if (isNetworkFailure(error)) return { list: readCachedMembers(), fromServer: false };
    throw error;
  }
  const list = data.map((m) => ({ id: m.user_id, role: m.role, name: m.display_name }));
  writeCachedMembers(list);
  return { list, fromServer: true };
}

// 名簿で自分を探す。締め出すのは、保存先の名簿を実際に読めて、そこにいなかった時だけ。
// 圏外で控えが空・古い時は締め出さず、前回の控えか仮の名前で開く(電波が戻ったら次回の起動で確かめ直す)
async function resolveMe(userId) {
  const { list, fromServer } = await loadMembers();
  memberList = list;
  const mine = list.find((m) => m.id === userId);
  if (mine) return { ...mine };
  if (fromServer) return null;
  const cached = readCachedMe();
  return cached?.id === userId ? cached : { id: userId, role: 'unknown', name: '自分' };
}

// ===== ログイン =====

export const needsLogin = true;

// 起動時: 保存済みの通行証があれば、その人として始める。名簿にいない人は締め出す
export async function init() {
  const { data, error } = await client.auth.getSession();
  const sessionUser = data.session?.user;
  if (!sessionUser) {
    // 圏外で通行証の更新ができなかった時は、前回の人として開く(送信は電波が戻ってから)
    const cached = readCachedMe();
    if (error && isNetworkFailure(error) && cached) {
      memberList = readCachedMembers();
      user = cached;
      return { ...user };
    }
    return null;
  }
  const mine = await resolveMe(sessionUser.id);
  if (!mine) {
    await signOut();
    return null;
  }
  setUser(mine);
  return { ...user };
}

export async function signIn(email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    if (isNetworkFailure(error)) throw new NetworkError('電波がありません。電波のある所でログインしてください');
    if (/Invalid login credentials/i.test(error.message)) throw new Error('メールアドレスかパスワードが違います');
    throw new Error(`ログインできませんでした: ${error.message}`);
  }
  const mine = await resolveMe(data.user.id);
  if (!mine) {
    await signOut();
    throw new Error('このアカウントは家族として登録されていません');
  }
  setUser(mine);
  return { ...user };
}

// パスワードを変える。今のパスワードでログインし直して確かめてから変える(間違っていたら変えない)。
// パスワードはどこにも保存しない(保存先に渡すだけ)。
export async function changePassword(current, next) {
  ensureOnline();
  const { data } = await client.auth.getSession();
  const email = data.session?.user?.email;
  if (!email) throw new Error('ログインし直してから変えてください');
  const check = await client.auth.signInWithPassword({ email, password: current });
  if (check.error) {
    if (isNetworkFailure(check.error)) throw new NetworkError('電波がある時に変えられます');
    if (/Invalid login credentials/i.test(check.error.message)) throw new Error('今のパスワードが違います');
    if (check.error.status === 429) throw new Error('続けて何度も試したため、しばらく変えられません。時間をおいてください');
    throw new Error(`今のパスワードを確かめられませんでした: ${check.error.message}`);
  }
  const { error } = await client.auth.updateUser({ password: next });
  if (error) {
    if (isNetworkFailure(error)) throw new NetworkError('電波がある時に変えられます');
    if (error.code === 'same_password' || /different from the old password/i.test(error.message)) throw new Error('今と同じパスワードには変えられません');
    if (error.code === 'weak_password' || /at least|weak|characters/i.test(error.message)) throw new Error('保存先に「弱いパスワード」と断られました。もっと長く、数字や記号もまぜてください');
    if (error.code === 'reauthentication_needed') throw new Error('ログインし直してから変えてください');
    if (error.status === 429) throw new Error('続けて何度も試したため、しばらく変えられません。時間をおいてください');
    throw new Error(`パスワードを変えられませんでした: ${error.message}`);
  }
}

export async function signOut() {
  setUser(null);
  memberList = [];
  try { localStorage.removeItem(MEMBERS_KEY); } catch { /* 無視 */ }
  await client.auth.signOut({ scope: 'local' }).catch(() => { /* 圏外でもスマホ側の通行証は消える */ });
}

export function me() {
  return user ? { ...user } : null;
}

export function members() {
  return memberList.map((m) => ({ ...m }));
}

// 試験用の「圏外のふり」は見本の保存先だけ。本物では何もしない
export function setFakeOffline() {}
export function isFakeOffline() { return false; }

// ===== 記録 =====

export async function listPins() {
  ensureOnline();
  const { data, error } = await limited(client
    .from('pins')
    .select('id, owner_id, lat, lng, photo_path, memo, stars, shared, recorded_at, created_at, reactions(id, pin_id, author_id, memo, stars, created_at)')
    .order('recorded_at', { ascending: true }));
  if (error) fail(error, '記録を読み込めませんでした');
  return data.map(rowToRecord); // 見本と同じ変換を通す
}

// 写真はログイン情報を添えて読み出す。一時保存は使わない
export async function fetchPhoto(pin) {
  if (!pin.photoPath) throw new Error('写真がありません');
  ensureOnline();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('ログインし直してください');
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${pin.photoPath}?nocache=${crypto.randomUUID()}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    fail(e);
  }
  if (!res.ok) throw new Error('この写真は見られません');
  return URL.createObjectURL(await res.blob());
}

// 送り直しでも同じ場所に上書きするだけ(二重にならない)。保存先・途中の配信網にも長く置かせない
export async function uploadPhoto(path, data, type) {
  ensureOnline();
  const { error } = await client.storage.from(BUCKET).upload(path, new Blob([data], { type }), {
    contentType: type,
    upsert: true,
    cacheControl: '0',
  });
  if (error) fail(error, `写真を送れませんでした: ${error.message}`);
}

// 同じ id で何度送っても1件だけ。「家族に見せる」の最初の状態は保存先が決める(長男は見せない)
export async function insertPin(pin) {
  ensureOnline();
  const { error } = await limited(client.from('pins').upsert({
    id: pin.id,
    lat: pin.lat,
    lng: pin.lng,
    photo_path: pin.photoPath,
    memo: pin.memo || '',
    stars: pin.stars ?? null,
    recorded_at: pin.recordedAt,
  }, { onConflict: 'id', ignoreDuplicates: true }));
  if (error) fail(error, `記録を送れませんでした: ${error.message}`);
}

async function updateOwn(id, fields) {
  ensureOnline();
  const { data, error } = await limited(client.from('pins').update(fields).eq('id', id).select('id'));
  if (error) fail(error, `変更できませんでした: ${error.message}`);
  if (!data || data.length === 0) throw new Error('自分の記録だけ変更できます');
}

// 自分の記録を消す。写真(と将来の小さな写真)を先に消し、消えたことを確かめてから記録を消す。
// 写真が消せなかった時は、記録を消さずに止める(写真だけが残る状態を作らない)。
// 付いた「一言・星」(reactions)は、保存先の決まり(on delete cascade)で記録と一緒に消える。
async function photoStillThere(path) {
  const { data } = await client.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}?nocache=${crypto.randomUUID()}`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${data.session?.access_token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return res.ok;
}

export async function deletePin(pin) {
  ensureOnline();
  const paths = [pin.photoPath, pin.thumbPath].filter(Boolean);
  for (const path of paths) {
    if (!path.startsWith(`${user.id}/`)) throw new Error('自分の写真だけ消せます');
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) fail(error, `写真を消せませんでした: ${error.message}`);
    // 断られても「エラーなし・0件」で返ることがあるため、本当に消えたかを読み出して確かめる
    let still;
    try { still = await photoStillThere(path); } catch (e) { fail(e); }
    if (still) throw new Error('写真を消せませんでした。記録は消していません');
  }
  const { data, error } = await limited(client.from('pins').delete().eq('id', pin.id).select('id'));
  if (error) fail(error, `記録を消せませんでした: ${error.message}`);
  if (!data || data.length === 0) throw new Error('記録を消せませんでした(自分の記録だけ消せます)');
}

export const setShared = (id, shared) => updateOwn(id, { shared });
export const updatePin = (id, { memo, stars }) => updateOwn(id, { memo, stars });

export async function addReaction({ id, pinId, memo, stars }) {
  ensureOnline();
  const { error } = await limited(client.from('reactions').upsert(
    { id, pin_id: pinId, memo: memo || '', stars: stars ?? null },
    { onConflict: 'id', ignoreDuplicates: true }
  ));
  if (error) fail(error, 'この記録には一言を付けられません');
}

// ===== 駅のメモ・手で付ける「行った」 =====
// 表は proposal-29-station-tables.sql(クラ確認後に施主が実行)。表・列がまだない時は「空」「係ではない」として扱う。
const isMissingTable = (error) => ['PGRST205', '42P01', 'PGRST204', '42703'].includes(error?.code);

export async function isStationEditor() {
  if (!user || !navigator.onLine) return false;
  const { data, error } = await limited(client.from('family_members').select('can_edit_station_notes').eq('user_id', user.id).maybeSingle());
  if (error) return false;
  return data?.can_edit_station_notes === true;
}

async function readAll(table, mapper) {
  const { data, error } = await limited(client.from(table).select('*'));
  if (error) {
    if (isMissingTable(error)) return [];
    fail(error, '駅のメモを読み込めませんでした');
  }
  return data.map(mapper);
}

export async function listStationData() {
  ensureOnline();
  const [notes, gourmet, tv] = await Promise.all([
    readAll('station_notes', noteRowToObj),
    readAll('station_gourmet', gourmetRowToObj),
    readAll('station_tv', tvRowToObj),
  ]);
  gourmet.sort((a, b) => a.rank - b.rank);
  tv.sort((a, b) => b.airedOn.localeCompare(a.airedOn));
  return { notes, gourmet, tv };
}

export async function saveStationNote(n) {
  ensureOnline();
  const err = checkLocalPick(n);
  if (err) throw new Error(err);
  const { error } = await limited(client.from('station_notes').upsert({
    station_id: n.stationId, station_name: n.stationName,
    local_pick: n.localPick || null, local_pick_from: n.localPick ? n.localPickFrom : null, local_pick_on: n.localPick ? n.localPickOn : null,
    updated_by: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'station_id' }));
  if (error) fail(error, `駅のメモを保存できませんでした: ${error.message}`);
}

// その駅のグルメトップ3を、渡した内容に置き換える
export async function replaceGourmet(stationId, items) {
  ensureOnline();
  const err = checkGourmetList(items);
  if (err) throw new Error(err);
  const del = await limited(client.from('station_gourmet').delete().eq('station_id', stationId));
  if (del.error) fail(del.error, `グルメを保存できませんでした: ${del.error.message}`);
  if (items.length === 0) return;
  const { error } = await limited(client.from('station_gourmet').insert(items.map((g) => ({
    station_id: stationId, rank: g.rank, dish: g.dish, shop: g.shop, confirmed_on: g.confirmedOn, source_url: g.sourceUrl, confirmed_by: user.id,
  }))));
  if (error) fail(error, `グルメを保存できませんでした: ${error.message}`);
}

export async function addTv(t) {
  ensureOnline();
  const err = checkTv(t);
  if (err) throw new Error(err);
  const { error } = await limited(client.from('station_tv').insert({
    station_id: t.stationId, program: t.program, aired_on: t.airedOn, source_url: t.sourceUrl, note: t.note || '', created_by: user.id,
  }));
  if (error) fail(error, `TVの紹介を保存できませんでした: ${error.message}`);
}

export async function deleteTv(id) {
  ensureOnline();
  const { error } = await limited(client.from('station_tv').delete().eq('id', id));
  if (error) fail(error, `消せませんでした: ${error.message}`);
}

// 手で付ける「行った」: 保存先の決まりで、本人の分しか返らない
export async function listManualVisits() {
  ensureOnline();
  return readAll('station_visits', visitRowToObj);
}

export async function addManualVisit(v) {
  ensureOnline();
  const err = checkVisit(v);
  if (err) throw new Error(err);
  const { error } = await limited(client.from('station_visits').upsert(
    { id: v.id, station_id: v.stationId, visited_on: v.visitedOn || null, memo: v.memo || '' },
    { onConflict: 'user_id,station_id', ignoreDuplicates: true }
  ));
  if (error) fail(error, `「行った」を付けられませんでした: ${error.message}`);
}

export async function removeManualVisit(stationId) {
  ensureOnline();
  const { error } = await limited(client.from('station_visits').delete().eq('station_id', stationId).eq('user_id', user.id));
  if (error) fail(error, `「行った」を外せませんでした: ${error.message}`);
}
