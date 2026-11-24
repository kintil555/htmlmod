/**
 * Minimal ZIP library (no dependencies). Reads stored + deflate archives with the browser's DecompressionStream,
 * writes stored or deflate archives with CompressionStream. Works in browsers and Node 18+.
 * Reads ZIP64 archives. ZipReader.fromBlob reads entries lazily from a Blob/File, so big archives are not loaded whole.
 * Not supported (rejected with a ZipError): encryption, other compression methods, single entries over 2 GB.
 */
const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const EOCD64_LOC = 20;
const EOCD64_MIN = 56;
const U32 = 0xffffffff;
/** Typed arrays cannot hold much more than this in browsers, so one entry may not be bigger. */
const MAX_ENTRY_BYTES = 0x7fffffff;
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

/**
 * Inflates/deflates through a stream. `exact`: `limit` is the exact output size, so the result is written into one
 * preallocated array (no chunk list + copy, half the peak memory for big files). Otherwise `limit` is an upper bound.
 */
async function pump(stream, input, limit, exact = false) {
  const w = stream.writable.getWriter();
  w.write(input).catch(() => {});
  w.close().catch(() => {});
  const r = stream.readable.getReader();
  const fixed = exact ? new Uint8Array(limit) : null;
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    if (n + value.length > limit) { r.cancel().catch(() => {}); throw new ZipError('size-mismatch'); }
    if (fixed) fixed.set(value, n); else chunks.push(value);
    n += value.length;
  }
  if (fixed) return n === limit ? fixed : fixed.subarray(0, n);
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

const inflate = (raw, size) => pump(new DecompressionStream('deflate-raw'), raw, size, true);
const deflate = raw => pump(new CompressionStream('deflate-raw'), raw, raw.length + (raw.length >> 1) + 1024);

const dataView = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

/** Reads a little-endian 64-bit value as a Number (exact below 2^53, anything larger is rejected as corrupt). */
function u64(v, pos) {
  const n = v.getUint32(pos, true) + v.getUint32(pos + 4, true) * 0x100000000;
  if (!Number.isSafeInteger(n)) throw new ZipError('corrupt');
  return n;
}

/**
 * Finds the central directory. `win` is the end of the file (or all of it). Returns { count, cdSize, cdOffset }, or
 * { need: offset } when the archive is ZIP64 and its 56-byte ZIP64 end record (at `need`) must be passed as `zip64Record`.
 */
function locateDirectory(win, zip64Record) {
  const v = dataView(win);
  let eocd = -1;
  for (let i = win.length - EOCD_MIN; i >= Math.max(0, win.length - EOCD_SEARCH); i--) {
    if (v.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not-a-zip');
  let count = v.getUint16(eocd + 10, true);
  let cdSize = v.getUint32(eocd + 12, true);
  let cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === U32 || cdOffset === U32) {
    const loc = eocd - EOCD64_LOC;
    if (loc < 0 || v.getUint32(loc, true) !== SIG_LOC64) throw new ZipError('corrupt');
    if (!zip64Record) return { need: u64(v, loc + 8) };
    const r = dataView(zip64Record);
    if (zip64Record.length < EOCD64_MIN || r.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('corrupt');
    count = u64(r, 32); cdSize = u64(r, 40); cdOffset = u64(r, 48);
  }
  return { count, cdSize, cdOffset };
}

/** Reads the ZIP64 extra field (id 0x0001): 8-byte values for exactly the 32-bit fields that were 0xffffffff. */
function readZip64Extra(v, pos, len, entry) {
  const end = pos + len;
  while (pos + 4 <= end) {
    const id = v.getUint16(pos, true);
    const size = v.getUint16(pos + 2, true);
    pos += 4;
    if (id === 0x0001) {
      const stop = pos + size;
      for (const key of ['size', 'csize', 'offset']) {
        if (entry[key] !== U32) continue;
        if (pos + 8 > stop) throw new ZipError('corrupt');
        entry[key] = u64(v, pos);
        pos += 8;
      }
      return;
    }
    pos += size;
  }
  throw new ZipError('corrupt');
}

/** Parses `count` central directory records from `cd` (bytes starting at the first record) into [[path, entry]]. */
function parseDirectory(cd, count, { maxEntries, maxUnpackedBytes }) {
  if (count > maxEntries) throw new ZipError('too-many-entries');
  const v = dataView(cd);
  const dec = new TextDecoder('utf-8');
  const raw = [];
  let pos = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cd.length || v.getUint32(pos, true) !== SIG_CEN) throw new ZipError('corrupt');
    const flags = v.getUint16(pos + 8, true);
    const nameLen = v.getUint16(pos + 28, true);
    const extraLen = v.getUint16(pos + 30, true);
    const commentLen = v.getUint16(pos + 32, true);
    if (pos + 46 + nameLen + extraLen + commentLen > cd.length) throw new ZipError('corrupt');
    const name = dec.decode(cd.subarray(pos + 46, pos + 46 + nameLen));
    const entry = {
      flags, method: v.getUint16(pos + 10, true), crc: v.getUint32(pos + 16, true),
      csize: v.getUint32(pos + 20, true), size: v.getUint32(pos + 24, true), offset: v.getUint32(pos + 42, true),
    };
    if (entry.csize === U32 || entry.size === U32 || entry.offset === U32) readZip64Extra(v, pos + 46 + nameLen, extraLen, entry);
    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || JUNK.test(name.replace(/\\/g, '/'))) continue;
    const path = normalizePath(name);
    if (!path) throw new ZipError('unsafe-path', name);
    if (flags & FLAG_ENCRYPTED) throw new ZipError('encrypted', name);
    if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) throw new ZipError('method', name);
    if (entry.size > MAX_ENTRY_BYTES || entry.csize > MAX_ENTRY_BYTES) throw new ZipError('too-large', name);
    total += entry.size;
    if (total > maxUnpackedBytes) throw new ZipError('too-large');
    raw.push([path, entry]);
  }
  return raw;
}

export class ZipReader {
  /**
   * Reads a ZIP held in memory. For big archives use `ZipReader.fromBlob`, which never loads the whole file.
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {{maxEntries:number, maxUnpackedBytes:number}} limits
   */
  constructor(buffer, limits) {
    this.entries = new Map();
    this.blob = null;
    this.u8 = null;
    this.size = 0;
    if (buffer == null) return; // fromBlob fills the rest in
    this.u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    this.size = this.u8.length;
    let dir = locateDirectory(this.u8, null);
    if (dir.need !== undefined) dir = locateDirectory(this.u8, this._slice(dir.need, dir.need + EOCD64_MIN));
    this._setEntries(parseDirectory(this._slice(dir.cdOffset, dir.cdOffset + dir.cdSize), dir.count, limits));
  }

  /**
   * Opens a ZIP from a Blob/File reading only the end of the file (central directory) up front; entry data is read
   * on demand with Blob.slice, so archives far bigger than the memory you would want to hold at once still open.
   * @param {Blob} blob
   * @param {{maxEntries:number, maxUnpackedBytes:number}} limits
   * @returns {Promise<ZipReader>}
   */
  static async fromBlob(blob, limits) {
    const zip = new ZipReader(null);
    zip.blob = blob;
    zip.size = blob.size;
    const winStart = Math.max(0, zip.size - EOCD_SEARCH - EOCD64_LOC);
    const win = await zip._read(winStart, zip.size);
    let dir = locateDirectory(win, null);
    if (dir.need !== undefined) dir = locateDirectory(win, await zip._read(dir.need, dir.need + EOCD64_MIN));
    zip._setEntries(parseDirectory(await zip._read(dir.cdOffset, dir.cdOffset + dir.cdSize), dir.count, limits));
    return zip;
  }

  _setEntries(raw) {
    // A single top-level folder (zipped a folder instead of its contents) is stripped.
    const first = raw[0]?.[0].split('/')[0];
    const strip = raw.length > 0 && raw.every(([p]) => p.includes('/') && p.split('/')[0] === first) ? first.length + 1 : 0;
    for (const [path, entry] of raw) this.entries.set(path.slice(strip), entry);
  }

  _slice(start, end, path = '') {
    if (!(start >= 0 && start <= end && end <= this.size)) throw new ZipError('corrupt', path);
    return this.u8.subarray(start, end);
  }

  async _read(start, end, path = '') {
    if (this.u8) return this._slice(start, end, path);
    if (!(start >= 0 && start <= end && end <= this.size)) throw new ZipError('corrupt', path);
    const out = new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
    if (out.length !== end - start) throw new ZipError('corrupt', path);
    return out;
  }

  has(path) { return this.entries.has(path); }
  names() { return [...this.entries.keys()]; }

  async bytes(path) {
    const e = this.entries.get(path);
    if (!e) throw new ZipError('missing-file', path);
    const head = await this._read(e.offset, e.offset + 30, path);
    const h = dataView(head);
    if (h.getUint32(0, true) !== SIG_LOC) throw new ZipError('corrupt', path);
    const start = e.offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const data = await this._read(start, start + e.csize, path);
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
