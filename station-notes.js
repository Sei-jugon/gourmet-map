// 駅のメモ(グルメトップ3・地元の一押し・TVで紹介)と、手で付ける「行った」の入力の決まり。
// 保存先の決まり(proposal-29-station-tables.sql の check)と同じ内容を、画面でも先に確かめる。
// 見本の保存先(backend-mock.js)も、この同じ確かめを使って本物と同じように断る。

export const STATION_ID_RE = /^m[0-9a-f]{10}$/;
const URL_RE = /^https?:\/\//;

// 日本時間の今日(YYYY-MM-DD)。スマホの時計の設定(時間帯)に関係なく、日本時間で決める。
// 保存先の決まり(proposal-29)も日本時間の今日で判定するので、両方をそろえる。now は試験用
export function todayInJapan(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

let clockForTest = null; // 試験用: 「今」を決めて確かめる時だけ使う
export function setClockForTest(date) { clockForTest = date; }
const today = () => todayInJapan(clockForTest ?? new Date());

const isPastOrToday = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today();
const len = (s) => [...(s || '')].length;

// グルメ1件。問題があれば理由(文字)を返す。なければ null
export function checkGourmet(g) {
  if (![1, 2, 3].includes(g.rank)) return '順位は1〜3です';
  if (!g.dish || len(g.dish) > 50) return `${g.rank}位: 料理名を50文字以内で書いてください`;
  if (!g.shop || len(g.shop) > 50) return `${g.rank}位: 店名を50文字以内で書いてください`;
  if (!g.confirmedOn) return `${g.rank}位: 確認日は必須です`;
  if (!isPastOrToday(g.confirmedOn)) return `${g.rank}位: 確認日に未来の日は使えません`;
  if (!g.sourceUrl || !URL_RE.test(g.sourceUrl)) return `${g.rank}位: 根拠のリンク(http〜)は必須です`;
  return null;
}

export function checkGourmetList(list) {
  const ranks = list.map((g) => g.rank);
  if (new Set(ranks).size !== ranks.length) return '同じ順位が2つあります';
  for (const g of list) {
    const e = checkGourmet(g);
    if (e) return e;
  }
  return null;
}

export function checkLocalPick(n) {
  if (!n.localPick) return null; // 書かないのはよい
  if (len(n.localPick) > 100) return '地元の一押しは100文字以内です';
  if (!n.localPickFrom) return '地元の一押しは「誰に聞いたか」も書いてください(個人名は書かない)';
  if (len(n.localPickFrom) > 40) return '「誰に聞いたか」は40文字以内です';
  if (!n.localPickOn) return '地元の一押しは「聞いた日」も書いてください';
  if (!isPastOrToday(n.localPickOn)) return '聞いた日に未来の日は使えません';
  return null;
}

export function checkTv(t) {
  if (!t.program || len(t.program) > 60) return '番組名を60文字以内で書いてください';
  if (!t.airedOn) return '放送日は必須です';
  if (!isPastOrToday(t.airedOn)) return '放送日に未来の日は使えません';
  if (!t.sourceUrl || !URL_RE.test(t.sourceUrl)) return '出典のリンク(http〜)は必須です';
  if (len(t.note) > 60) return '一言は60文字以内です(番組の文章は写さない)';
  return null;
}

export function checkVisit(v) {
  if (!STATION_ID_RE.test(v.stationId || '')) return '駅の番号が正しくありません';
  if (v.visitedOn && !isPastOrToday(v.visitedOn)) return '行った日に未来の日は使えません';
  if (len(v.memo) > 100) return '一言は100文字以内です';
  return null;
}
