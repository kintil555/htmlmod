/**
 * Minimal ZIP library (no dependencies). Reads stored + deflate archives with the browser's DecompressionStream,
 * writes stored or deflate archives with CompressionStream. Works in browsers and Node 18+.
 * Not supported (rejected with a ZipError): encryption, ZIP64, other compression methods.
 */
const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_SEARCH = EOCD_MIN + 0xffff;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$)/;

export class ZipError extends Error {
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.code = code; this.detail = detail; }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Returns a safe relative path ('a/b.js') or null when the name is empty, absolute or escapes the archive. */
export function normalizePath(name) {
  const parts = [];
  for (const seg of String(name).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || /^[a-zA-Z]:$/.test(seg) || seg.includes('\0')) return null;
    parts.push(seg);
  }
  if (String(name).replace(/\\/g, '/').startsWith('/')) return null;
  return parts.length ? parts.join('/') : null;
}

async function pump(stream, input, limit) {
  const w = stream.writable.getWriter();
  w.write(input).catch(() => {});
  w.close().catch(() => {});
  const r = stream.readable.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > limit) { r.cancel().catch(() => {}); throw new ZipError('size-mismatch'); }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const inflate = (raw, size) => pump(new DecompressionStream('deflate-raw'), raw, size);
const deflate = raw => pump(new CompressionStream('deflate-raw'), raw, raw.length + (raw.length >> 1) + 1024);

export class ZipReader {
  /**
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {{maxEntries:number, maxUnpackedBytes:number}} limits
   */
  constructor(buffer, limits) {
    this.u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.view = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.entries = new Map();
    this._parse(limits);
  }

  _parse({ maxEntries, maxUnpackedBytes }) {
    const v = this.view;
    let eocd = -1;
    for (let i = this.u8.length - EOCD_MIN; i >= Math.max(0, this.u8.length - EOCD_SEARCH); i--) {
      if (v.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new ZipError('not-a-zip');
    const count = v.getUint16(eocd + 10, true);
    const cdOffset = v.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('zip64');
    if (count > maxEntries) throw new ZipError('too-many-entries');
    const dec = new TextDecoder('utf-8');
    const raw = [];
    let pos = cdOffset;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > this.u8.length || v.getUint32(pos, true) !== SIG_CEN) throw new ZipError('corrupt');
      const flags = v.getUint16(pos + 8, true);
      const nameLen = v.getUint16(pos + 28, true);
      const extraLen = v.getUint16(pos + 30, true);
      const commentLen = v.getUint16(pos + 32, true);
      const name = dec.decode(this.u8.subarray(pos + 46, pos + 46 + nameLen));
      const entry = {
        flags, method: v.getUint16(pos + 10, true), crc: v.getUint32(pos + 16, true),
        csize: v.getUint32(pos + 20, true), size: v.getUint32(pos + 24, true), offset: v.getUint32(pos + 42, true),
      };
      pos += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/') || JUNK.test(name.replace(/\\/g, '/'))) continue;
      const path = normalizePath(name);
      if (!path) throw new ZipError('unsafe-path', name);
      if (flags & FLAG_ENCRYPTED) throw new ZipError('encrypted', name);
      if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) throw new ZipError('method', name);
      if (entry.size === 0xffffffff || entry.csize === 0xffffffff) throw new ZipError('zip64');
      total += entry.size;
      if (total > maxUnpackedBytes) throw new ZipError('too-large');
      raw.push([path, entry]);
    }
    // A single top-level folder (zipped a folder instead of its contents) is stripped.
    const first = raw[0]?.[0].split('/')[0];
    const strip = raw.length > 0 && raw.every(([p]) => p.includes('/') && p.split('/')[0] === first) ? first.length + 1 : 0;
    for (const [path, entry] of raw) this.entries.set(path.slice(strip), entry);
  }

  has(path) { return this.entries.has(path); }
  names() { return [...this.entries.keys()]; }

  async bytes(path) {
    const e = this.entries.get(path);
    if (!e) throw new ZipError('missing-file', path);
    const v = this.view;
    if (e.offset + 30 > this.u8.length || v.getUint32(e.offset, true) !== SIG_LOC) throw new ZipError('corrupt', path);
    const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
    if (start + e.csize > this.u8.length) throw new ZipError('corrupt', path);
    const data = this.u8.subarray(start, start + e.csize);
    const out = e.method === METHOD_STORE ? data : await inflate(data, e.size);
    if (out.length !== e.size || crc32(out) !== e.crc) throw new ZipError('corrupt', path);
    return out;
  }

  async text(path) { return new TextDecoder('utf-8').decode(await this.bytes(path)); }
}

/**
 * Builds a ZIP. files: [{ path, data: Uint8Array|string }]. Deflates when CompressionStream exists and it helps.
 * @returns {Promise<Uint8Array>}
 */
export async function writeZip(files, { deflate: useDeflate = true } = {}) {
  const enc = new TextEncoder();
  const canDeflate = useDeflate && typeof CompressionStream === 'function';
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const path = normalizePath(f.path);
    if (!path) throw new ZipError('unsafe-path', f.path);
    const name = enc.encode(path);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    let body = data;
    let method = METHOD_STORE;
    if (canDeflate && data.length > 64) {
      const packed = await deflate(data);
      if (packed.length < data.length) { body = packed; method = METHOD_DEFLATE; }
    }
    const crc = crc32(data);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, SIG_LOC, true); h.setUint16(4, 20, true); h.setUint16(6, FLAG_UTF8, true); h.setUint16(8, method, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    head.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const c = new DataView(cen.buffer);
    c.setUint32(0, SIG_CEN, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, FLAG_UTF8, true);
    c.setUint16(10, method, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(head, body);
    central.push(cen);
    offset += head.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(EOCD_MIN);
  const e = new DataView(end.buffer);
  e.setUint32(0, SIG_EOCD, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(offset + cdSize + EOCD_MIN);
  let o = 0;
  for (const b of all) { out.set(b, o); o += b.length; }
  return out;
}
