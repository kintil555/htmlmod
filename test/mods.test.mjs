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

// manifest
const m = await parseManifest(new ZipReader(await writeZip(files), L), 'x.zip');
assert.deepEqual([m.id, m.name, m.main, m.html], ['t-mod', 'T', 'main.js', null]);
const noJson = await parseManifest(new ZipReader(await writeZip([{ path: 'index.html', data: '<p>' }]), L), 'My Cool Mod.zip');
assert.deepEqual([noJson.id, noJson.html, noJson.main], ['my-cool-mod', 'index.html', null]);
const fail = async (list, key) => assert.rejects(parseManifest(new ZipReader(await writeZip(list), L), 'mod-x.zip'), e => e instanceof ModError && e.key === key);
await fail([{ path: 'readme.txt', data: 'x' }], 'noEntry');
await fail([{ path: 'mod.json', data: '{bad' }, { path: 'main.js', data: '' }], 'badManifest');
await fail([{ path: 'mod.json', data: '{"id":"A B"}' }, { path: 'main.js', data: '' }], 'badId');
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
