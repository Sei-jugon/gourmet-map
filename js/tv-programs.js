// テレビ番組の候補店の「番組の設定」。番組を増やす時は、PROGRAMS に1つ足すだけ(データの「番組」の列と label を同じにする)。
//  key      データの番号の頭文字や、切り替えの記憶の名前
//  label    番組名。データの「番組」の列と同じ字。行きたい店の「おすすめした人」にもこの字が入る(20字まで)
//  symbol   地図のマークと切り替えボタンの絵
//  chip     切り替えボタンの id。sharedWith があるときは、その既存ボタン(🍌)と同じ切り替えを使う
//  defaultOn 最初からオンか(🍌だけオン)
//  caution  吹き出しに必ず添える固定の一行(なければ空)
export const PROGRAMS = [
  {
    key: 'sk', label: 'せっかくグルメ', symbol: '🍌', fallbackSymbol: 'バ', color: '#fde047', edge: '#a16207', ink: '#713f12',
    defaultOn: true, sharedChip: 'banana-chip', caution: '',
  },
  {
    key: 'kd', label: '孤独のグルメ', symbol: '🍚', fallbackSymbol: '米', color: '#bbf7d0', edge: '#15803d', ink: '#14532d',
    defaultOn: false, chip: 'tv-kd-chip', caution: '夜のみの営業・要予約の店が多いです',
  },
  {
    key: 'om', label: 'オモウマい店', symbol: '💥', fallbackSymbol: '爆', color: '#fecaca', edge: '#b91c1c', ink: '#7f1d1d',
    defaultOn: false, chip: 'tv-om-chip', caution: '行列・売り切れ・不定休が多いです',
  },
];

export const programByLabel = (label) => PROGRAMS.find((p) => p.label === label) || null;
export const programByKey = (key) => PROGRAMS.find((p) => p.key === key) || null;

// 行きたい店の「ジャンル」は8つの決まり(ラーメン/和食/中華/洋食/カフェ/スイーツ/パン/その他)から選ぶ決まりなので、
// 番組のジャンルの字を見て、上から順に最初に当たった物にする。元のジャンルはメモに残す。
export const GENRE_RULES = [
  [/スイーツ|かき氷|ケーキ|パフェ/, 'スイーツ'],
  [/カフェ|喫茶/, 'カフェ'],
  [/パン|ベーカリー|バーガー/, 'パン'],
  [/中華|餃子|町中華|焼売|台湾/, '中華'],
  [/洋食|オムライス|ステーキ|ハンバーグ|パスタ|ピザ|イタリアン|フレンチ|カレー|グリル/, '洋食'],
  [/寿司|海鮮|うなぎ|鰻|丼|定食|天ぷら|とんかつ|串かつ|焼肉|郷土|京料理|懐石|鍋|お好み|たこ焼|漬物|食堂|居酒屋|地鶏|刺身|魚/, '和食'],
];
export function mapGenre(raw) {
  const g = raw || '';
  if (/ラーメン|中華そば|ちゃんぽん|タンメン|担々/.test(g)) return 'ラーメン';
  if (/うどん|そば|蕎麦|麺/.test(g)) return '和食';
  for (const [re, genre] of GENRE_RULES) if (genre && re.test(g)) return genre;
  return 'その他';
}

export const ACCURACY_TEXT = {
  name: '店名で一致した位置',
  city: '市区町村の中心あたり',
  pref: '都道府県の中心あたり',
  none: '位置が見つかっていません',
};
export const isApprox = (shop) => shop.accuracy !== 'name';
export const hasLatLng = (shop) => shop.lat != null && shop.lng != null;

// 候補店 → 行きたい店(wishlist)に入れる中身。表(列)は変えず、今ある列と決まりの範囲で収める。
//  店名=店名 / ジャンル=8つのどれか(元のジャンルはメモ) / おすすめした人=番組名 / 元のリンク=出典URL
//  場所の決め方=search(検索から)。おおよその位置は、メモに「位置はおおよそ」と書いて印にする
export function candidateToWish(shop) {
  const memo = [
    `テレビ候補(未確認): ${shop.program}${shop.airedOn ? ` ${shop.airedOn}放送` : ''}`,
    shop.genre,
    isApprox(shop) ? `位置はおおよそ(${ACCURACY_TEXT[shop.accuracy] || ACCURACY_TEXT.none})` : '',
    shop.note,
  ].filter(Boolean).join(' / ');
  const has = hasLatLng(shop);
  return {
    name: shop.name,
    provisional: false,
    genre: mapGenre(shop.genre),
    address: `${shop.pref || ''}${shop.city || ''}`,
    memo: [...memo].slice(0, 200).join(''),
    sourceUrl: /^https?:\/\//.test(shop.sourceUrl || '') ? shop.sourceUrl : null,
    recommenders: [shop.program],
    lat: has ? shop.lat : null,
    lng: has ? shop.lng : null,
    positionSource: has ? 'search' : null,
    private: false,
    visitedOn: null,
  };
}
