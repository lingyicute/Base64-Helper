'use strict';
// index.html 是单文件应用，这里按注释标记把其中与 DOM 无关的纯函数切出来，供 Node 直接测试。
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function between(from, to) {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('无法在 index.html 中定位：' + from + ' … ' + to);
  return html.slice(a, b);
}

const source = [
  'const encoder=new TextEncoder();',
  'const PREVIEW_LIMIT=200000;',
  "const CLIP_NOTE='\\n…（预览已截断，复制与下载将使用完整内容）';",
  between('function fmtBytes', 'const numberFormatter'),
  between('function countChars', 'let snT;'),
  between('// 截取前 n 个 UTF-16 单元', 'function setFieldError'),
  between('/* ============ Base64 核心', '/* Large inputs'),
  between('function computeTask', 'const WORKER_THRESHOLD'),
  'return {fmtBytes,sliceSafe,clipPreview,bytesToB64,formatB64,percentToBytes,b64PayloadToBytes,decodeB64,extOf,kindOfMime,sniff,tryUtf8,analyze,computeTask,EXT};',
].join('\n');

const core = new Function(source)();

const test = require('node:test');
const assert = require('node:assert/strict');

const enc = (s) => new TextEncoder().encode(s);
const bytes = (r) => Array.from(r.bytes);

test('fmtBytes 在单位边界进位', () => {
  assert.equal(core.fmtBytes(1023), '1023 B');
  assert.equal(core.fmtBytes(1024), '1.00 KB');
  assert.equal(core.fmtBytes(1048575), '1.00 MB');
  assert.equal(core.fmtBytes(5e12), '4.55 TB');
});

test('编码 / 解码往返，覆盖全部格式选项', () => {
  for (let n = 0; n < 200; n += 7) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const std = Buffer.from(data).toString('base64');
    assert.equal(core.bytesToB64(data), std);
    for (const o of [{}, { urlsafe: true }, { nopad: true }, { wrap: true }, { urlsafe: true, nopad: true, wrap: true }]) {
      if (!n) continue;
      assert.deepEqual(bytes(core.decodeB64(core.formatB64(std, o))), Array.from(data), JSON.stringify(o));
    }
  }
});

test('76 列换行不会在末尾留下空行', () => {
  assert.deepEqual(core.formatB64('A'.repeat(152), { wrap: true }).split('\n').map((l) => l.length), [76, 76]);
  assert.deepEqual(core.formatB64('A'.repeat(153), { wrap: true }).split('\n').map((l) => l.length), [76, 76, 1]);
});

test('非法 Base64 给出明确错误', () => {
  assert.throws(() => core.decodeB64('QU*D'), /第 3 个字符/);
  assert.throws(() => core.decodeB64('Q'), /长度无效/);
  assert.throws(() => core.decodeB64('QQ==QQ=='), /填充符/);
  assert.throws(() => core.decodeB64('=='), /只有填充符/);
});

test('Data URI：base64、百分号编码与缺失标记', () => {
  assert.deepEqual(core.decodeB64('data:image/png;base64,QUJD'), { bytes: enc('ABC'), mime: 'image/png' });
  assert.deepEqual(bytes(core.decodeB64('data:text/plain,hello%20w+x')), Array.from(enc('hello w+x')));
  assert.deepEqual(bytes(core.decodeB64('data:text/plain;charset=utf-8,%E4%BD%A0')), Array.from(enc('你')));
  assert.deepEqual(bytes(core.decodeB64('data:image/png,%89PNG')), [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual(bytes(core.decodeB64('data:image/png,QUJD')), Array.from(enc('ABC')));
});

test('Data URI：畸形媒体类型被忽略', () => {
  const r = core.decodeB64('data:base64,QUJD');
  assert.equal(r.mime, null);
  assert.deepEqual(bytes(r), Array.from(enc('ABC')));
  assert.equal(core.decodeB64('data:foo,bar').mime, null);
});

test('PEM 封装只解码正文', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nQUJD\nREVG\n-----END CERTIFICATE-----\n';
  assert.deepEqual(bytes(core.decodeB64(pem)), Array.from(enc('ABCDEF')));
  const withHeaders = '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,AB\n\nQUJD\n-----END RSA PRIVATE KEY-----';
  assert.deepEqual(bytes(core.decodeB64(withHeaders)), Array.from(enc('ABC')));
  assert.throws(() => core.decodeB64('-----BEGIN A-----\nQUJD'), /PEM/);
  assert.throws(() => core.decodeB64(pem + pem), /多个 PEM/);
});

test('extOf：已知映射、结构化后缀与未知类型', () => {
  assert.equal(core.extOf('image/png'), 'png');
  assert.equal(core.extOf('application/ld+json'), 'json');
  assert.equal(core.extOf('constructor'), 'bin');
  assert.equal(core.extOf('application/vnd.android.package-archive'), 'apk');
  assert.equal(core.extOf('application/vnd.something-else'), 'bin');
  assert.equal(core.extOf('application/x-www-form-urlencoded'), 'bin');
  assert.equal(core.extOf('text/x-unknown-thing'), 'txt');
});

test('sniff 按文件头识别类型', () => {
  const mime = (b) => core.analyze(Uint8Array.from(b), null).mime;
  assert.equal(mime([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
  assert.equal(mime([0x7f, 0x45, 0x4c, 0x46, 2, 1]), 'application/x-elf');
  assert.equal(mime([0, 1, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0]), 'font/ttf');
  assert.equal(core.analyze(enc('<svg xmlns="x"/>'), null).mime, 'image/svg+xml');
  // UTF-16LE BOM 不应被当成 MP3
  assert.equal(core.analyze(Uint8Array.of(0xff, 0xfe, 0x41, 0), null).mime, 'text/plain');
  // 以 MZ / OTTO 开头的普通文本仍是文本
  assert.equal(core.analyze(enc('MZ' + 'x'.repeat(100)), null).mime, 'text/plain');
  assert.equal(core.analyze(enc('OTTO is a name!!'), null).mime, 'text/plain');
  const pe = new Uint8Array(128);
  pe.set([0x4d, 0x5a]);
  pe[60] = 64;
  pe.set([0x50, 0x45, 0, 0], 64);
  assert.equal(core.analyze(pe, null).ext, 'exe');
});

test('analyze：JSON、提示类型与二进制回退', () => {
  assert.equal(core.analyze(enc('{"a":1}'), null).mime, 'application/json');
  assert.equal(core.analyze(enc('abc'), 'text/html').mime, 'text/html');
  const bin = core.analyze(Uint8Array.of(1, 2, 3, 200), null);
  assert.equal(bin.mime, 'application/octet-stream');
  assert.equal(bin.text, null);
});

test('截断预览不会切开代理对', () => {
  assert.equal(core.sliceSafe('😀😀', 1), '');
  assert.equal(core.sliceSafe('😀😀', 2), '😀');
  const clipped = core.clipPreview('😀'.repeat(100001));
  assert.ok(!/[\ud800-\udbff]\n/.test(clipped));
});

test('computeTask：空白输入在 skipEmpty 下视为空', () => {
  assert.deepEqual(core.computeTask({ type: 'decode', input: '  \n', skipEmpty: true }), { empty: true });
  const r = core.computeTask({ type: 'encode', input: '你好', opts: {}, counts: true });
  assert.equal(r.out, '5L2g5aW9');
  assert.equal(r.byteLength, 6);
  assert.equal(r.inputChars, 2);
});

test('PEM：块前后可带说明文字，PGP 装甲的 CRC 行被忽略，标签不一致时报错', () => {
  const body = '-----BEGIN CERTIFICATE-----\nQUJD\nREVG\n-----END CERTIFICATE-----';
  assert.deepEqual(bytes(core.decodeB64('Bag Attributes\n  friendlyName: x\n' + body + '\nsome trailing note')), Array.from(enc('ABCDEF')));
  const pgp = '-----BEGIN PGP MESSAGE-----\nVersion: x\n\nQUJD\n=abcd\n-----END PGP MESSAGE-----';
  assert.deepEqual(bytes(core.decodeB64(pgp)), Array.from(enc('ABC')));
  assert.throws(() => core.decodeB64('-----BEGIN A-----\nQUJD\n-----END B-----'), /标签不一致/);
});
