// 「行きたい店を追加」の貼り付け欄の読み取り(端末の中だけ。Googleのページを開いて読むことはしない)。
// 4通り:
//  (a) 短いリンクだけ(maps.app.goo.gl など) … リンクは「元のGoogleマップのリンク」として残す。店名・場所は分からない
//  (b) 店名・住所を含む文章(共有文など) … 店名・住所・リンクを取り出す(取れない所は手入力)
//  (c) 位置の数字を含む長いアドレス(@緯度,経度 / !3d…!4d… / ?q=緯度,経度 など) … 位置をそのまま使う
//  (d) プラスコード(完全な形「8Q6QWQH5+FW9」/短い形「WQH5+FW9 京都市、京都府」)
//  (e) Googleマップ以外のリンク(食べログなど) … 「元のリンク」として残す。位置は取れない
//  (f) どれにも当てはまらない文字 … 固まらず、やさしく案内する(入力した文字は消さない)
// どんな文字が来ても例外を出さず、分かった所だけを返す。
import { isFull, isShort, decode } from './olc.js';

const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const PREF_RE = new RegExp(`(${PREFS.join('|')})`);
const OLC = '23456789CFGHJMPQRVWX';
const PLUS_RE = new RegExp(`(^|[^0-9A-Za-z])([${OLC}${OLC.toLowerCase()}]{4,8}\\+[${OLC}${OLC.toLowerCase()}]{2,3})(?=$|[^0-9A-Za-z])`);
const URL_RE = /https?:\/\/[^\s<>"'「」()（）]+/gi;
const SHORT_LINK_RE = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i;
const GOOGLE_MAPS_RE = /^https?:\/\/((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i;
// 共有文に混ざりがちな、店名でも住所でもない行
const NOISE_RE = /^(google\s*マップ|googleマップで(見る|開く)|共有|場所を共有|map|maps)$/i;

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// 長いアドレスから位置と店名を取り出す
export function positionFromUrl(url) {
  const u = safeDecode(url).replace(/\+/g, ' ');
  const tryPair = (m) => (m && inRange(Number(m[1]), Number(m[2])) ? { lat: Number(m[1]), lng: Number(m[2]) } : null);
  // 店の位置そのもの(!3d!4d)を優先し、次に q= など、最後に地図の中心(@)
  const pos = tryPair(u.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/))
    || tryPair(u.match(/[?&](?:q|query|ll|destination|daddr|center)=\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/))
    || tryPair(u.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/));
  let name = null;
  const place = u.match(/\/maps\/place\/([^/@?]+)/);
  if (place) name = place[1].trim();
  else {
    const q = u.match(/[?&](?:q|query)=([^&]+)/);
    if (q && !/^\s*-?\d/.test(q[1])) name = q[1].trim();
  }
  return { position: pos, name: name || null };
}

function looksLikeAddress(line) {
  return PREF_RE.test(line) || /〒?\s*\d{3}-?\d{4}/.test(line) || /[市区町村郡].*\d/.test(line) || /\d+丁目|\d+番地?|\d+-\d+/.test(line);
}

// 店名らしい行か(ふつうの文章・記号だけの行は店名にしない)
function looksLikeName(line) {
  const t = line.trim();
  if (!t || [...t].length > 40) return false;
  if (/[。]/.test(t) || /[?？!！]$/.test(t)) return false;
  if (/[<>{}]/.test(t)) return false; // HTMLなどの文字が混ざった物は店名にしない
  // 文字(かな・カナ・漢字・英字)が1つもなければ店名ではない
  return /[ぁ-んァ-ヶ一-龠A-Za-zＡ-Ｚａ-ｚ]/.test(t);
}

function cleanAddress(s) {
  return s.replace(/〒?\s*\d{3}-?\d{4}\s*/, '').replace(/^[\s,、，・·]+|[\s,、，・·]+$/g, '').trim();
}

function cleanName(s) {
  return s.replace(/^[\s「『【]+|[\s」』】,、，・·]+$/g, '').trim();
}

export function parsePaste(raw) {
  const out = { kind: 'empty', sourceUrl: null, isGoogleLink: false, name: null, address: null, position: null, positionSource: null, plusCode: null, message: '' };
  if (typeof raw !== 'string') return out;
  // 見えない文字・特殊な空白をそろえる
  const text = raw.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').replace(/\r\n?/g, '\n').replace(/[\u00A0\u3000]/g, ' ').trim();
  if (!text) {
    out.message = '貼り付ける物がありません';
    return out;
  }

  const urls = text.match(URL_RE) || [];
  // 元のリンク: Googleマップのリンクがあればそれ、なければ最初のリンク(食べログなど)
  const googleUrl = urls.find((u) => GOOGLE_MAPS_RE.test(u)) || null;
  out.sourceUrl = googleUrl || urls[0] || null;
  out.isGoogleLink = !!googleUrl;
  let rest = text.replace(URL_RE, ' ');

  // (c) 長いアドレスの位置
  for (const u of urls) {
    const { position, name } = positionFromUrl(u);
    if (position && !out.position) {
      out.position = position;
      out.positionSource = 'url';
    }
    if (name && !out.name) out.name = name;
  }

  // (d) プラスコード
  const pm = rest.match(PLUS_RE);
  if (pm) {
    const code = pm[2].toUpperCase();
    const after = rest.slice(pm.index + pm[0].length).split('\n')[0];
    const locality = after.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    if (isFull(code)) {
      const d = decode(code);
      out.plusCode = { code, full: true, locality: null };
      if (!out.position) {
        out.position = { lat: d.lat, lng: d.lng };
        out.positionSource = 'plus_code';
      }
    } else if (isShort(code)) {
      // 「京都市、京都府」→ 検索には「京都府 京都市」の順で使う
      out.plusCode = { code, full: false, locality: locality.length ? locality.slice().reverse().join(' ') : null };
    }
    rest = rest.slice(0, pm.index) + pm[1] + rest.slice(pm.index + pm[0].length).replace(after, '');
  }

  // (b) 店名・住所
  const lines = rest.split('\n').map((l) => l.trim()).filter((l) => l && !NOISE_RE.test(l));
  for (const line of lines) {
    if (!out.address && looksLikeAddress(line)) {
      // 1行に「店名, 住所」「店名 · 住所」と並んでいる時は分ける
      const m = line.match(PREF_RE) || line.match(/〒?\s*\d{3}-?\d{4}/);
      const before = m && m.index > 0 ? cleanName(line.slice(0, m.index)) : '';
      out.address = cleanAddress(m && m.index > 0 ? line.slice(m.index) : line);
      if (before && !out.name && !looksLikeAddress(before)) out.name = before.slice(0, 60);
    } else if (!out.name && looksLikeName(line)) {
      out.name = cleanName(line).slice(0, 60) || null;
    }
  }

  // 種類と、やさしい案内
  const onlyShortLink = urls.length > 0 && urls.every((u) => SHORT_LINK_RE.test(u)) && !lines.length && !out.plusCode;
  const otherLinkOnly = urls.length > 0 && !googleUrl && !out.name && !out.address && !out.position && !out.plusCode;
  if (onlyShortLink) {
    out.kind = 'short_link';
    out.message = 'リンクだけでは店が分からないので、店名を入れてください。場所は「この店名で探す」か地図で決めてください。';
  } else if (otherLinkOnly) {
    out.kind = 'other_link';
    out.message = 'リンクを「元のリンク」に入れました。場所は分からないので、店名を入れて「この店名で探す」か、地図で選んでください。';
  } else if (out.plusCode && !out.plusCode.full) {
    out.kind = out.plusCode.locality ? 'plus_short' : 'plus_short_no_area';
    out.message = out.plusCode.locality
      ? `プラスコードを読み取りました。「プラスコードから場所を決める」を押すと「${out.plusCode.locality}」を手がかりに場所を決めます。店名を入れてください。`
      : 'プラスコードの地域名が分かりません。地図で近くを動かして選んでください。店名を入れてください。';
  } else if (out.plusCode && out.plusCode.full) {
    out.kind = 'plus_full';
    out.message = 'プラスコードから場所を決めました。店名を入れてください。';
  } else if (out.position) {
    out.kind = 'long_url';
    out.message = out.name ? 'アドレスから場所と店名を読み取りました。' : 'アドレスから場所を読み取りました。店名を入れてください。';
  } else if (out.name || out.address) {
    out.kind = out.address ? 'share_text' : 'name_only';
    out.message = out.address ? '店名と住所を読み取りました。「この店名で探す」で場所の候補を出せます。' : '店名を読み取りました。「この店名で探す」で場所の候補を出せます。';
  } else {
    out.kind = 'unknown';
    out.message = 'Googleマップのリンクか、店名を入れてくださいね。';
  }
  return out;
}
