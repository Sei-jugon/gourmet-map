// 画面確認用の見本データ(実在のお店ではない)。保存先の登録後に使わなくなる。
// 見本では「夫がログインしている」とみなす。
export const SAMPLE_ME = 'husband';

function placeholderPhoto(emoji, color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">` +
    `<rect width="640" height="400" fill="${color}"/>` +
    `<text x="320" y="250" font-size="160" text-anchor="middle">${emoji}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const SAMPLE_PINS = [
  {
    id: 'sample-1',
    lat: 35.2324, lng: 139.1069,
    photoUrl: placeholderPhoto('🍜', '#fde68a'),
    memo: '見本: 峠のラーメン。スープが濃いめ',
    stars: 4,
    recorder: 'husband',
    shared: true,
    createdAt: '2026-09-20T12:10:00+09:00',
    reactions: [{ by: 'wife', memo: '麺がもちもち', stars: 5 }],
  },
  {
    id: 'sample-2',
    lat: 35.4986, lng: 138.7686,
    photoUrl: placeholderPhoto('🍦', '#bfdbfe'),
    memo: '見本: 湖畔のソフトクリーム',
    stars: 5,
    recorder: 'wife',
    shared: true,
    createdAt: '2026-09-20T15:30:00+09:00',
    reactions: [],
  },
  {
    id: 'sample-3',
    lat: 35.4160, lng: 138.5800,
    photoUrl: placeholderPhoto('🍱', '#bbf7d0'),
    memo: '',
    stars: null,
    recorder: 'husband',
    shared: false,
    createdAt: '2026-09-27T11:45:00+09:00',
    reactions: [],
  },
];
