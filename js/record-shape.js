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
