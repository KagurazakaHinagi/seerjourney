/* Compress before upload; only small image references enter shared campaign state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis);
  else root.CampaignImages = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const MAX_BYTES = 8 * 1024 * 1024, MAX_INPUT_BYTES = 100 * 1024 * 1024;
  const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  function checkDimensions(width, height) {
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 32768) || width * height > 100000000) throw new Error('This image is too large to process. Choose an image under 100 megapixels.');
  }
  async function decode(file) {
    if (root.createImageBitmap) {
      try {
        const bitmap = await root.createImageBitmap(file, { imageOrientation: 'from-image' });
        return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch (_) { /* Safari may support an image through its normal image decoder. */ }
    }
    const url = URL.createObjectURL(file), image = new root.Image();
    try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; }); }
    catch (_) { URL.revokeObjectURL(url); throw new Error('This image could not be opened. Choose a valid JPEG, PNG, WebP, or GIF.'); }
    return { image, width: image.naturalWidth, height: image.naturalHeight, close() { image.src = ''; URL.revokeObjectURL(url); } };
  }
  async function encode(image, width, height, type, quality) {
    const canvas = root.document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image compression is unavailable. Try another browser.');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
      ctx.drawImage(image, 0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
      if (!blob) throw new Error('This image could not be compressed. Try a smaller image.');
      return blob;
    } finally { canvas.width = canvas.height = 0; }
  }
  async function prepare(file, options = {}) {
    if (!file || !TYPES[file.type] || !file.size) throw new Error('Choose a JPEG, PNG, WebP, or GIF image.');
    if (file.size > MAX_INPUT_BYTES) throw new Error('Choose an original image smaller than 100 MB.');
    options.onProgress?.({ stage: 'preparing' });
    const decoded = await (options.decode || decode)(file);
    try {
      checkDimensions(decoded.width, decoded.height);
      if (file.size <= MAX_BYTES) return { file, width: decoded.width, height: decoded.height, compressed: false, originalSize: file.size };
      options.onProgress?.({ stage: 'compressing' });
      const aspect = Math.min(1, 4096 / Math.max(decoded.width, decoded.height));
      let width = Math.max(1, Math.round(decoded.width * aspect)), height = Math.max(1, Math.round(decoded.height * aspect));
      const encoder = options.encode || encode;
      for (let scale = 0; scale < 7; scale++) {
        for (const quality of [0.88, 0.76, 0.62]) {
          let blob = await encoder(decoded.image, width, height, 'image/webp', quality);
          // Browsers without WebP canvas encoding return PNG; use JPEG instead.
          if (blob.type !== 'image/webp') blob = await encoder(decoded.image, width, height, 'image/jpeg', quality);
          if (blob.size > 0 && blob.size <= MAX_BYTES && TYPES[blob.type]) {
            const stem = String(file.name || 'image').replace(/\.[^.]*$/, '').slice(0, 180) || 'image';
            const compressed = new File([blob], `${stem}.${TYPES[blob.type]}`, { type: blob.type, lastModified: Date.now() });
            return { file: compressed, width, height, compressed: true, originalSize: file.size };
          }
        }
        width = Math.max(1, Math.floor(width * 0.75)); height = Math.max(1, Math.floor(height * 0.75));
      }
      throw new Error('This image could not be reduced below 8 MB. Try a smaller image.');
    } finally { decoded.close?.(); }
  }
  async function withDeadline(operation, milliseconds, message) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error(message)); }, milliseconds);
    });
    try { return await Promise.race([operation(controller.signal), timeout]); }
    finally { clearTimeout(timer); }
  }
  async function json(fetcher, body) {
    return withDeadline(async signal => {
    const response = await fetcher('/api/images', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal,
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('Image storage could not be reached. Try again.'); }
    if (!response.ok) throw new Error(data.message || 'The image could not be uploaded. Try again.');
    return data;
    }, 30000, 'Image storage timed out. Check your connection and try again.');
  }
  async function base64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(binary);
  }
  async function upload(original, options = {}) {
    const fetcher = options.fetch || root.fetch.bind(root);
    const prepared = await prepare(original, options);
    const config = await json(fetcher);
    const campaignId = config.campaignId || 'chult-zh-cn';
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(campaignId)) throw new Error('Image storage is not configured.');
    const id = root.crypto.randomUUID();
    const pathname = `campaigns/${campaignId}/${id}.${TYPES[prepared.file.type]}`;
    const metadata = { id, pathname, name: prepared.file.name.slice(0, 200), type: prepared.file.type, width: prepared.width, height: prepared.height };
    options.onProgress?.({ stage: 'uploading', percent: 0 });
    let result;
    if (config.mode === 'local') {
      result = await json(fetcher, { op: 'local', ...metadata, data: await base64(prepared.file) });
    } else if (config.mode === 'blob') {
      const send = options.uploadBlob || root.CampaignBlobUpload;
      if (!send) throw new Error('Image uploads are unavailable. Reload this page and try again.');
      await withDeadline(abortSignal => send(pathname, prepared.file, { access: 'public', handleUploadUrl: '/api/images', multipart: false, contentType: prepared.file.type, abortSignal,
        onUploadProgress: event => options.onProgress?.({ stage: 'uploading', percent: event.percentage }) }), 120000, 'Image upload timed out. Check your connection and try again.');
      options.onProgress?.({ stage: 'confirming' });
      result = await json(fetcher, { op: 'confirm', ...metadata });
    } else throw new Error('Image storage is not configured.');
    return result;
  }
  return { MAX_BYTES, TYPES, prepare, upload, withDeadline };
});
