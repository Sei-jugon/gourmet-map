// 写真の縮小。長辺1280px程度のJPEGにする。
// 描き直すので、写真に埋め込まれた撮影場所などの情報も消える(家族以外に位置が漏れにくい)。

const MAX_EDGE = 1280;
const QUALITY = 0.8;

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // 古い端末向けの予備
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function shrinkPhoto(file) {
  const src = await decode(file);
  const w = src.width;
  const h = src.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  if (src.close) src.close();

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('写真を縮小できませんでした'))), 'image/jpeg', QUALITY)
  );
  return { blob, width: canvas.width, height: canvas.height };
}
