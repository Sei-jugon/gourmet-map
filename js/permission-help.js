// 位置情報を拒否した時に出す、設定アプリでの再許可手順。
// 項目名は iOS 18 / Android 14 の Chrome を想定。端末の版によって少し違うことがある(実機で要確認)。

export function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return 'ios'; // iPad(パソコン表示)
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const STEPS = {
  ios: [
    {
      title: '① iPhone全体の位置情報をオンにする',
      steps: [
        '「設定」アプリを開く',
        '「プライバシーとセキュリティ」→「位置情報サービス」',
        'いちばん上の「位置情報サービス」をオンにする',
        '同じ画面を下にずらし、「Safariのサイト」を押す',
        '「このAppの使用中」(または「次回確認」)を選び、「正確な位置情報」をオンにする',
      ],
    },
    {
      title: '② Safariで拒否になっていたら戻す',
      steps: [
        '「設定」アプリのトップに戻る',
        '「アプリ」→「Safari」を押す(古いiPhoneは、設定のトップにある「Safari」)',
        '下の方の「位置情報」を押す',
        '「確認」または「許可」を選ぶ(「拒否」になっていたら直す)',
      ],
    },
  ],
  android: [
    {
      title: '① スマホ全体の位置情報をオンにする',
      steps: [
        '画面の上から下にスワイプし、「位置情報」をオンにする',
      ],
    },
    {
      title: '② Chromeでこのアプリを許可する',
      steps: [
        '「Chrome」アプリを開き、右上の「︙」→「設定」',
        '「サイトの設定」→「位置情報」',
        '「ブロック」の中にこのアプリのアドレスがあれば押して、「許可」にする',
      ],
    },
  ],
  other: [
    {
      title: 'ブラウザで位置情報を許可する',
      steps: [
        'アドレス欄の左にある鍵などのマークを押す',
        '「位置情報」を「許可」にする',
      ],
    },
  ],
};

export function buildSteps(platform = detectPlatform()) {
  const frag = document.createDocumentFragment();
  for (const section of STEPS[platform]) {
    const h = document.createElement('h3');
    h.textContent = section.title;
    const ol = document.createElement('ol');
    for (const s of section.steps) {
      const li = document.createElement('li');
      li.textContent = s;
      ol.append(li);
    }
    frag.append(h, ol);
  }
  if (platform === 'ios') {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'iPhoneの版によって、項目の名前が少し違うことがあります。';
    frag.append(p);
  }
  return frag;
}
