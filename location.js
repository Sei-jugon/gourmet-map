// 現在地を1回だけ取る(追いかけ続けない)。GPSは圏外でも使える。

export function getPositionOnce(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('この端末では現在地が使えません'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => {
        const messages = {
          1: '現在地の使用が許可されていません(設定で許可してください)',
          2: '現在地がわかりませんでした',
          3: '現在地の取得に時間がかかりすぎました',
        };
        const e = new Error(messages[err.code] || '現在地がわかりませんでした');
        e.denied = err.code === 1; // 拒否された時は、設定アプリでの再許可手順を出す
        reject(e);
      },
      // 古い位置は使わない(走ってきた直後だと、1分前の位置は1km近くずれることがある)
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}
