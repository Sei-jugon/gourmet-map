// 記録の形を1か所で決める。見本(backend-mock.js)と本物(backend-supabase.js)の両方がここを通す。
// 入力は保存先の表と同じ形(pins の1行 + 付いた一言 reactions の配列)。
// 見本と本物で、同じ入力から同じ形の出力が出るようにするため(2026-10-07 写真の場所の見落としを受けて)。

export const RECORD_KEYS = ['id', 'ownerId', 'lat', 'lng', 'photoPath', 'memo', 'stars', 'shared', 'recordedAt', 'createdAt', 'reactions'];
export const REACTION_KEYS = ['id', 'pinId', 'authorId', 'memo', 'stars', 'createdAt'];

export function rowToRecord(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    lat: row.lat,
    lng: row.lng,
    photoPath: row.photo_path ?? null,
    memo: row.memo ?? '',
    stars: row.stars ?? null,
    shared: row.shared,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
    reactions: (row.reactions || [])
      .map((x) => ({
        id: x.id,
        pinId: x.pin_id,
        authorId: x.author_id,
        memo: x.memo ?? '',
        stars: x.stars ?? null,
        createdAt: x.created_at,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

// ===== 駅のメモ・手で付ける「行った」(proposal-29 の表と同じ形の行 → 画面用) =====
export const noteRowToObj = (r) => ({
  stationId: r.station_id, stationName: r.station_name,
  localPick: r.local_pick ?? null, localPickFrom: r.local_pick_from ?? null, localPickOn: r.local_pick_on ?? null,
});
export const gourmetRowToObj = (r) => ({
  id: r.id, stationId: r.station_id, rank: r.rank, dish: r.dish, shop: r.shop,
  confirmedOn: r.confirmed_on, sourceUrl: r.source_url,
});
export const tvRowToObj = (r) => ({
  id: r.id, stationId: r.station_id, program: r.program, airedOn: r.aired_on, sourceUrl: r.source_url, note: r.note ?? '',
});
export const visitRowToObj = (r) => ({
  id: r.id, stationId: r.station_id, visitedOn: r.visited_on ?? null, memo: r.memo ?? '',
});

// ===== 行きたい店(proposal-31 の表と同じ形の行 → 画面用) =====
export const wishRowToObj = (r) => ({
  id: r.id, ownerId: r.owner_id, name: r.name, provisional: !!r.provisional, genre: r.genre ?? null,
  memo: r.memo ?? '', recommenders: r.recommenders || [],
  sourceUrl: r.source_url ?? null, address: r.address ?? '', lat: r.lat ?? null, lng: r.lng ?? null,
  positionSource: r.position_source ?? null, private: !!r.private, visitedOn: r.visited_on ?? null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});
export const wishObjToRow = (w) => ({
  name: w.name.trim(), provisional: !!w.provisional, genre: w.genre || null,
  memo: w.memo || '', recommenders: w.recommenders || [],
  source_url: w.sourceUrl || null, address: w.address || '', lat: w.lat ?? null, lng: w.lng ?? null,
  position_source: w.lat != null ? w.positionSource : null, private: !!w.private, visited_on: w.visitedOn || null,
});
