// 「行きたい店」の入力の決まり。保存先の決まり(proposal-31-wishlist.sql の check)と同じ内容を、画面でも先に確かめる。
// 見本の保存先(backend-mock.js)も、この同じ確かめを使って本物と同じように断る。
import { todayInJapan } from './station-notes.js';

export const POSITION_SOURCES = ['plus_code', 'url', 'search', 'map'];
export const GENRES = ['ラーメン', '和食', '中華', '洋食', 'カフェ', 'スイーツ', 'パン', 'その他'];
// 店名が空でジャンルを選んだ時の仮の名前(例: 「ラーメン(仮)」)
export const provisionalName = (genre) => `${genre}(仮)`;
const len = (s) => [...(s || '')].length;

export function checkWish(w) {
  if (!w.name || !w.name.trim()) return '店名を入れてください';
  if (len(w.name) > 60) return '店名は60文字までです';
  if (len(w.memo) > 200) return 'メモは200文字までです';
  if (len(w.address) > 120) return '住所は120文字までです';
  const recs = w.recommenders || [];
  if (recs.length > 6) return 'おすすめした人は6人までです';
  if (recs.some((r) => !r || len(r) > 20)) return 'おすすめした人の名前は1〜20文字です';
  if (w.sourceUrl && (!/^https?:\/\//.test(w.sourceUrl) || len(w.sourceUrl) > 500)) return '元のリンクは「https://」か「http://」で始まる500文字までです';
  if (w.genre && !GENRES.includes(w.genre)) return 'ジャンルが分かりません';
  if (w.provisional && !w.genre) return '仮の名前にはジャンルが要ります';
  const hasLat = w.lat != null;
  const hasLng = w.lng != null;
  if (hasLat !== hasLng) return '場所の数字が片方だけです';
  if (hasLat && !(Math.abs(w.lat) <= 90 && Math.abs(w.lng) <= 180)) return '場所の数字が正しくありません';
  if (hasLat && !POSITION_SOURCES.includes(w.positionSource)) return '場所の決め方が分かりません';
  if (w.visitedOn && w.visitedOn > todayInJapan()) return '行った日に未来の日は使えません';
  return null;
}
