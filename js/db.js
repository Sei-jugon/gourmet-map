// スマホの中の保存場所(IndexedDB)。圏外の時の「未送信」と、最後に見た地図の控えを置く。

const DB_NAME = 'touring-gourmet';
const DB_VERSION = 2; // 2: 見本の保存先に駅のメモ・手で付ける「行った」を追加

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const make = (name, options) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options); };
        make('outbox', { keyPath: 'seq', autoIncrement: true }); // 未送信(送る順に並ぶ)
        make('pin_cache', { keyPath: 'id' });                     // 最後に受け取った記録の控え
        // 見本の保存先(PCでの試験用)
        make('mock_pins', { keyPath: 'id' });
        make('mock_reactions', { keyPath: 'id' });
        make('mock_photos', { keyPath: 'path' });
        make('mock_station_notes', { keyPath: 'station_id' });
        make('mock_station_gourmet', { keyPath: 'id' });
        make('mock_station_tv', { keyPath: 'id' });
        make('mock_station_visits', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const add = (store, value) => run(store, 'readwrite', (s) => s.add(value));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const count = (store) => run(store, 'readonly', (s) => s.count());

// 中身を丸ごと入れ替える(記録の控えの更新用。見えなくなった記録はここで消える)
export function replaceAll(store, values) {
  return run(store, 'readwrite', (s) => {
    s.clear();
    for (const v of values) s.put(v);
  });
}

// 試験用: スマホの中の保存場所を丸ごと消す(開いている接続を閉じてから)
export async function deleteEverything() {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve; // 他のタブが開いている時は、そのタブを閉じた後に消える
  });
}
