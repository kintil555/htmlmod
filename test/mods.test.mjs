import assert from 'node:assert/strict';
import { ZipReader, ZipError, writeZip, normalizePath, crc32 } from '../src/mods/Zip.js';
import { parseManifest, ModError } from '../src/mods/Manifest.js';
import { rewriteImports, findImports, resolveRelative, loadModule } from '../src/mods/Modules.js';

const L = { maxEntries: 100, maxUnpackedBytes: 1e6 };
const big = 'hello world '.repeat(500);
const files = [{ path: 'mod.json', data: '{"id":"t-mod","name":"T"}' }, { path: 'main.js', data: big }, { path: 'img/a.bin', data: new Uint8Array([1, 2, 3, 250]) }];

for (const deflate of [false, true]) {
  const zip = new ZipReader(await writeZip(files, { deflate }), L);
  assert.deepEqual(zip.names().sort(), ['img/a.bin', 'main.js', 'mod.json']);
  assert.equal(await zip.text('main.js'), big);
  assert.deepEqual([...await zip.bytes('img/a.bin')], [1, 2, 3, 250]);
}
assert.ok((await writeZip(files)).length < (await writeZip(files, { deflate: false })).length, 'deflate shrinks');

// wrapping folder stripped
const wrapped = new ZipReader(await writeZip(files.map(f => ({ ...f, path: `my/${f.path}` }))), L);
assert.ok(wrapped.has('mod.json') && wrapped.has('img/a.bin'));

// paths
assert.equal(normalizePath('a/./b\\c.js'), 'a/b/c.js');
for (const bad of ['../x', '/abs', 'a/../../x', 'C:/x']) assert.equal(normalizePath(bad), null, bad);
await assert.rejects(writeZip([{ path: '../evil', data: 'x' }]), ZipError);

// limits and corruption
assert.throws(() => new ZipReader(new Uint8Array(100), L), e => e.code === 'not-a-zip');
const zbytes = await writeZip(files);
assert.throws(() => new ZipReader(zbytes, { maxEntries: 2, maxUnpackedBytes: 1e6 }), e => e.code === 'too-many-entries');
assert.throws(() => new ZipReader(zbytes, { maxEntries: 9, maxUnpackedBytes: 10 }), e => e.code === 'too-large');
const raw = await writeZip([{ path: 'a.txt', data: 'abcdef' }], { deflate: false });
raw[30 + 5] ^= 0xff; // flip a data byte
await assert.rejects(new ZipReader(raw, L).bytes('a.txt'), e => e.code === 'corrupt');
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);

// Blob reader: lazy, same results as the buffer reader, big payloads
{
  const blobZip = await ZipReader.fromBlob(new Blob([await writeZip(files)]), L);
  assert.deepEqual(blobZip.names().sort(), ['img/a.bin', 'main.js', 'mod.json']);
  assert.equal(await blobZip.text('main.js'), big);
  await assert.rejects(ZipReader.fromBlob(new Blob([new Uint8Array(100)]), L), e => e.code === 'not-a-zip');
  const payload = new Uint8Array(96 * 1024 * 1024).map((_, i) => (i * 31) ^ (i >> 7));
  const bigZip = await writeZip([{ path: 'mod.json', data: '{"id":"big-mod"}' }, { path: 'main.js', data: 'x' }, { path: 'data.bin', data: payload }], { deflate: false });
  const BL = { maxEntries: 100, maxUnpackedBytes: 2 ** 31 };
  const bz = await ZipReader.fromBlob(new Blob([bigZip]), BL);
  assert.equal(crc32(await bz.bytes('data.bin')), crc32(payload), 'big stored entry');
  const packed = await writeZip([{ path: 'data.bin', data: new Uint8Array(64 * 1024 * 1024) }]);
  const pz = await ZipReader.fromBlob(new Blob([packed]), BL);
  assert.equal((await pz.bytes('data.bin')).length, 64 * 1024 * 1024, 'big deflated entry');
}

// ZIP64: 32-bit fields = 0xffffffff, real values in the extra field + ZIP64 end record and locator
{
  const name = new TextEncoder().encode('main.js');
  const data = new TextEncoder().encode('export default () => 1;');
  const lh = new Uint8Array(30 + name.length); const l = new DataView(lh.buffer);
  l.setUint32(0, 0x04034b50, true); l.setUint16(4, 45, true); l.setUint32(14, crc32(data), true);
  l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); lh.set(name, 30);
  const extra = new Uint8Array(4 + 24); const x = new DataView(extra.buffer);
  x.setUint16(0, 1, true); x.setUint16(2, 24, true);
  x.setBigUint64(4, BigInt(data.length), true); x.setBigUint64(12, BigInt(data.length), true); x.setBigUint64(20, 0n, true);
  const cen = new Uint8Array(46 + name.length + extra.length); const c = new DataView(cen.buffer);
  c.setUint32(0, 0x02014b50, true); c.setUint16(4, 45, true); c.setUint16(6, 45, true); c.setUint32(16, crc32(data), true);
  c.setUint32(20, 0xffffffff, true); c.setUint32(24, 0xffffffff, true); c.setUint16(28, name.length, true);
  c.setUint16(30, extra.length, true); c.setUint32(42, 0xffffffff, true); cen.set(name, 46); cen.set(extra, 46 + name.length);
  const cdOffset = lh.length + data.length;
  const rec = new Uint8Array(56); const r = new DataView(rec.buffer);
  r.setUint32(0, 0x06064b50, true); r.setBigUint64(4, 44n, true); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
  r.setBigUint64(24, 1n, true); r.setBigUint64(32, 1n, true); r.setBigUint64(40, BigInt(cen.length), true); r.setBigUint64(48, BigInt(cdOffset), true);
  const loc = new Uint8Array(20); const lc = new DataView(loc.buffer);
  lc.setUint32(0, 0x07064b50, true); lc.setBigUint64(8, BigInt(cdOffset + cen.length), true); lc.setUint32(16, 1, true);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, 0xffff, true); e.setUint16(10, 0xffff, true); e.setUint32(12, 0xffffffff, true); e.setUint32(16, 0xffffffff, true);
  const z64 = new Uint8Array([...lh, ...data, ...cen, ...rec, ...loc, ...end]);
  for (const zip of [new ZipReader(z64, L), await ZipReader.fromBlob(new Blob([z64]), L)]) {
    assert.deepEqual(zip.names(), ['main.js']);
    assert.equal(await zip.text('main.js'), 'export default () => 1;');
  }
}

// manifest
const m = await parseManifest(new ZipReader(await writeZip(files), L), 'x.zip');
assert.deepEqual([m.id, m.name, m.main, m.html], ['t-mod', 'T', 'main.js', null]);
const noJson = await parseManifest(new ZipReader(await writeZip([{ path: 'index.html', data: '<p>' }]), L), 'My Cool Mod.zip');
assert.deepEqual([noJson.id, noJson.html, noJson.main], ['my-cool-mod', 'index.html', null]);
const fail = async (list, key) => assert.rejects(parseManifest(new ZipReader(await writeZip(list), L), 'mod-x.zip'), e => e instanceof ModError && e.key === key);
await fail([{ path: 'readme.txt', data: 'x' }], 'noEntry');
await fail([{ path: 'mod.json', data: '{bad' }, { path: 'main.js', data: '' }], 'badManifest');
await fail([{ path: 'mod.json', data: '{"id":"A B"}' }, { path: 'main.js', data: '' }], 'badId');
await fail([{ path: 'mod.json', data: '{"api":0}' }, { path: 'main.js', data: '' }], 'tooOldApi');
{
  const { CONFIG } = await import('../src/config.js');
  const { isOutdated } = await import('../src/mods/Manifest.js');
  assert.equal(isOutdated(CONFIG.mods.apiVersion), false, 'current API is not outdated');
  assert.equal(isOutdated(CONFIG.mods.apiVersion - 1), true, 'older API is outdated');
  assert.ok(CONFIG.mods.minApiVersion <= CONFIG.mods.apiVersion);
}
await fail([{ path: 'mod.json', data: '{"api":99}' }, { path: 'main.js', data: '' }], 'newerApi');
await fail([{ path: 'mod.json', data: '{"main":"nope.js"}' }], 'missingFile');

// imports
const has = p => ['lib/a.js', 'lib/b/index.js', 'main.js'].includes(p);
assert.equal(resolveRelative('lib/a.js', '../main.js'), 'main.js');
assert.equal(resolveRelative('main.js', '../x'), null);
const src = "import * as T from 'three';\nimport { a } from './lib/a';\nexport { b } from \"./lib/b\";\nconst m = await import('./lib/a.js');\nimport './missing.js';";
assert.deepEqual(findImports('main.js', src, has).map(i => i.target), ['lib/a.js', 'lib/b/index.js', 'lib/a.js', null]);
const out = rewriteImports('main.js', src, has, p => `blob:${p}`);
assert.ok(out.includes("from 'three'") && out.includes("'blob:lib/a.js'") && out.includes('"blob:lib/b/index.js"') && out.includes("'./missing.js'"));

// module graph order + cycle
const mem = new Map([['main.js', "import { a } from './a.js'; export default () => a;"], ['a.js', 'export const a = 1;']]);
const zipLike = { has: p => mem.has(p), text: async p => mem.get(p) };
const seen = [];
await loadModule(zipLike, 'main.js', () => {}, async url => { seen.push(url); return {}; });
assert.equal(seen.length, 1);
mem.set('a.js', "import './main.js';");
await assert.rejects(loadModule(zipLike, 'main.js', () => {}, async () => ({})), e => e.key === 'cycle');
console.log('mods tests ok');
