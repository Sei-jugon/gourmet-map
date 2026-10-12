// プラスコード(Open Location Code)の読み取り・位置への変換。端末の中だけで計算する(外の変換サーバーは使わない)。
// 公開されている仕様(https://github.com/google/open-location-code/blob/main/Documentation/Specification/specification.md)
// に沿って、このアプリ用に小さく自作した物(公式のプログラムは写していない)。
//
// 完全な形: 「8Q6QWQH5+FW9」(そのまま位置になる)
// 短い形:   「WQH5+FW9」(近くの基準の位置があれば、完全な形に戻せる)

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PADDING = '0';
const PAIR_CODE_LENGTH = 10;
const GRID_CODE_LENGTH = 5;
const GRID_ROWS = 5;
const GRID_COLS = 4;
const LAT_MAX = 90;
const LNG_MAX = 180;
// 最も細かい単位(緯度・経度1度あたりの数)。整数で計算して、端数の誤差を避ける
const FINAL_LAT_PRECISION = 8000 * GRID_ROWS ** GRID_CODE_LENGTH; // 25,000,000
const FINAL_LNG_PRECISION = 8000 * GRID_COLS ** GRID_CODE_LENGTH; // 8,192,000

export function isValid(code) {
  if (typeof code !== 'string' || !code) return false;
  const c = code.toUpperCase();
  const sep = c.indexOf(SEPARATOR);
  if (sep === -1 || sep !== c.lastIndexOf(SEPARATOR)) return false;
  if (sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  if (c.length - sep - 1 === 1) return false; // 「+」の後ろが1文字だけはだめ
  const pad = c.indexOf(PADDING);
  if (pad > -1) {
    if (pad === 0 || sep < SEPARATOR_POSITION) return false;
    const run = c.match(new RegExp(`${PADDING}+`, 'g'));
    if (run.length > 1 || run[0].length % 2 === 1 || run[0].length > SEPARATOR_POSITION - 2) return false;
    if (c[c.length - 1] !== SEPARATOR) return false;
  }
  for (const ch of c.replace(SEPARATOR, '').replace(new RegExp(PADDING, 'g'), '')) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

export function isShort(code) {
  return isValid(code) && code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

export function isFull(code) {
  if (!isValid(code) || isShort(code)) return false;
  const c = code.toUpperCase();
  if (ALPHABET.indexOf(c[0]) * 20 >= LAT_MAX * 2) return false;
  if (c.length > 1 && ALPHABET.indexOf(c[1]) * 20 >= LNG_MAX * 2) return false;
  return true;
}

export function encode(lat, lng, codeLength = PAIR_CODE_LENGTH) {
  const clippedLat = Math.min(LAT_MAX, Math.max(-LAT_MAX, lat));
  let latVal = Math.floor(Math.round((clippedLat + LAT_MAX) * FINAL_LAT_PRECISION * 1e6) / 1e6);
  let lngVal = Math.floor(Math.round((lng + LNG_MAX) * FINAL_LNG_PRECISION * 1e6) / 1e6);
  if (latVal >= 2 * LAT_MAX * FINAL_LAT_PRECISION) latVal = 2 * LAT_MAX * FINAL_LAT_PRECISION - 1;
  const lngRange = 2 * LNG_MAX * FINAL_LNG_PRECISION;
  lngVal = ((lngVal % lngRange) + lngRange) % lngRange;
  let code = '';
  if (codeLength > PAIR_CODE_LENGTH) {
    for (let i = 0; i < GRID_CODE_LENGTH; i++) {
      code = ALPHABET[(latVal % GRID_ROWS) * GRID_COLS + (lngVal % GRID_COLS)] + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lngVal = Math.floor(lngVal / GRID_COLS);
    }
  } else {
    latVal = Math.floor(latVal / GRID_ROWS ** GRID_CODE_LENGTH);
    lngVal = Math.floor(lngVal / GRID_COLS ** GRID_CODE_LENGTH);
  }
  for (let i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
    code = ALPHABET[lngVal % 20] + code;
    code = ALPHABET[latVal % 20] + code;
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }
  code = `${code.slice(0, SEPARATOR_POSITION)}${SEPARATOR}${code.slice(SEPARATOR_POSITION)}`;
  return code.slice(0, codeLength + 1);
}

// 完全な形 → 範囲と中心
export function decode(code) {
  if (!isFull(code)) throw new Error('完全な形のプラスコードではありません');
  const digits = code.toUpperCase().replace(SEPARATOR, '').replace(new RegExp(`${PADDING}+`, 'g'), '').slice(0, PAIR_CODE_LENGTH + GRID_CODE_LENGTH);
  let latUnits = 0;
  let lngUnits = 0;
  // 1組目の1桁は20度、以後1組ごとに1/20(最小単位で数える)
  let latStep = 20 * FINAL_LAT_PRECISION;
  let lngStep = 20 * FINAL_LNG_PRECISION;
  const pairs = Math.min(digits.length, PAIR_CODE_LENGTH);
  for (let i = 0; i < pairs; i += 2) {
    latUnits += ALPHABET.indexOf(digits[i]) * latStep;
    lngUnits += ALPHABET.indexOf(digits[i + 1]) * lngStep;
    if (i + 2 < pairs) {
      latStep /= 20;
      lngStep /= 20;
    }
  }
  let latSize = latStep;
  let lngSize = lngStep;
  if (digits.length > PAIR_CODE_LENGTH) {
    let rowStep = FINAL_LAT_PRECISION / 8000;
    let colStep = FINAL_LNG_PRECISION / 8000;
    for (let i = PAIR_CODE_LENGTH; i < digits.length; i++) {
      rowStep /= GRID_ROWS;
      colStep /= GRID_COLS;
      const v = ALPHABET.indexOf(digits[i]);
      latUnits += Math.floor(v / GRID_COLS) * rowStep;
      lngUnits += (v % GRID_COLS) * colStep;
    }
    latSize = rowStep;
    lngSize = colStep;
  }
  const latLo = latUnits / FINAL_LAT_PRECISION - LAT_MAX;
  const lngLo = lngUnits / FINAL_LNG_PRECISION - LNG_MAX;
  const latHi = latLo + latSize / FINAL_LAT_PRECISION;
  const lngHi = lngLo + lngSize / FINAL_LNG_PRECISION;
  return {
    latLo, lngLo, latHi, lngHi,
    lat: Math.min(latLo + (latHi - latLo) / 2, LAT_MAX),
    lng: Math.min(lngLo + (lngHi - lngLo) / 2, LNG_MAX),
    codeLength: Math.min(digits.length, PAIR_CODE_LENGTH + GRID_CODE_LENGTH),
  };
}

// 短い形 → 基準の位置に一番近い完全な形
export function recoverNearest(shortCode, refLat, refLng) {
  if (!isShort(shortCode)) {
    if (isFull(shortCode)) return shortCode.toUpperCase();
    throw new Error('プラスコードとして読めません');
  }
  const lat = Math.min(LAT_MAX, Math.max(-LAT_MAX, refLat));
  let lng = ((refLng + LNG_MAX) % 360 + 360) % 360 - LNG_MAX;
  const code = shortCode.toUpperCase();
  const paddingLength = SEPARATOR_POSITION - code.indexOf(SEPARATOR);
  const resolution = 20 ** (2 - paddingLength / 2); // 足りない頭の部分が表す範囲(度)
  const half = resolution / 2;
  const area = decode(encode(lat, lng).slice(0, paddingLength) + code);
  let latC = area.lat;
  let lngC = area.lng;
  if (lat + half < latC && latC - resolution >= -LAT_MAX) latC -= resolution;
  else if (lat - half > latC && latC + resolution <= LAT_MAX) latC += resolution;
  if (lng + half < lngC) lngC -= resolution;
  else if (lng - half > lngC) lngC += resolution;
  return encode(latC, lngC, area.codeLength);
}
