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
  between('function safeFileName', 'const supportStates'),
  between('// 截取前 n 个 UTF-16 单元', 'function setFieldError'),
  between('/* ============ Base64 核心', '/* Large inputs'),
  between('function computeTask', 'const WORKER_THRESHOLD'),
  'return {safeFileName,fmtBytes,sliceSafe,clipPreview,bytesToB64,formatB64,percentToBytes,b64PayloadToBytes,decodeB64,extOf,kindOfMime,sniff,tryUtf8,analyze,computeTask,EXT};',
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

test('解码：去掉外层引号，base64 标记可位于任意参数位置', () => {
  assert.deepEqual(bytes(core.decodeB64('"QUJD"')), Array.from(enc('ABC')));
  assert.deepEqual(bytes(core.decodeB64("'data:text/plain;base64,QUJD'")), Array.from(enc('ABC')));
  assert.deepEqual(bytes(core.decodeB64('data:text/plain;base64;charset=utf-8,QUJD')), Array.from(enc('ABC')));
  assert.deepEqual(bytes(core.decodeB64('data:text/plain;charset=utf-8,"x"')), Array.from(enc('"x"')));
});

test('analyze：容器格式沿用声明的类型，文本类沿用声明的扩展名', () => {
  const zip = Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0, 0, 0);
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal(core.analyze(zip, docx).ext, 'docx');
  assert.equal(core.analyze(zip, 'APPLICATION/EPUB+ZIP').ext, 'epub');
  // 无关的声明类型不能覆盖文件头
  assert.equal(core.analyze(zip, 'image/png').mime, 'application/zip');
  const ftyp = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
  assert.equal(core.analyze(ftyp, null).mime, 'video/mp4');
  const m4a = core.analyze(ftyp, 'audio/mp4');
  assert.deepEqual([m4a.mime, m4a.ext, m4a.kind], ['audio/mp4', 'm4a', 'audio']);
  assert.equal(core.analyze(enc('{\\rtf1 hi}'), 'application/rtf').ext, 'rtf');
  assert.equal(core.analyze(enc('{"a":1}'), 'application/ld+json').ext, 'json');
  assert.equal(core.analyze(enc('hello'), 'application/pdf').mime, 'text/plain');
});

test('extOf：OpenDocument 与 jar', () => {
  assert.equal(core.extOf('application/vnd.oasis.opendocument.text'), 'odt');
  assert.equal(core.extOf('application/java-archive'), 'jar');
  assert.equal(core.analyze(Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0, 0, 0), 'application/vnd.oasis.opendocument.spreadsheet').ext, 'ods');
});

test('safeFileName：非法字符、结尾点与 Windows 设备名', () => {
  assert.equal(core.safeFileName(' a/b\\c:d?.png ', 'x'), 'a_b_c_d_.png');
  assert.equal(core.safeFileName('report.', 'x'), 'report');
  assert.equal(core.safeFileName('..  ', 'decoded.bin'), 'decoded.bin');
  assert.equal(core.safeFileName('NUL.txt', 'x'), '_NUL.txt');
  assert.equal(core.safeFileName('com1', 'x'), '_com1');
  assert.equal(core.safeFileName('console.log', 'x'), 'console.log');
});

test('Worker 源码只依赖 helpers 列表中的函数（在隔离上下文中实际运行）', () => {
  const vm = require('node:vm');
  const names = /const helpers=\[([^\]]+)\]/.exec(html)[1].split(',').map((s) => s.trim());
  const fns = new Function(source.replace(/return \{[^}]*\};$/, '') + '\nreturn {' + names.join(',') + '};')();
  const handler = between('self.onmessage=function', 'self.postMessage({ready:true});');
  const code = '"use strict";\nconst encoder=new TextEncoder();\nconst EXT=' + JSON.stringify(core.EXT) + ';\n'
    + names.map((n) => fns[n].toString()).join('\n') + '\n' + handler;
  const posted = [];
  const self = { postMessage: (m) => posted.push(m) };
  vm.runInNewContext(code, { self, TextEncoder, TextDecoder, btoa, atob });
  const run = (request) => { self.onmessage({ data: { id: posted.length + 1, request } }); return posted[posted.length - 1]; };

  assert.equal(run({ type: 'encode', input: '你好', opts: { urlsafe: true, nopad: true }, counts: true }).result.out, '5L2g5aW9');
  const d = run({ type: 'decode', input: 'data:image/png;base64,iVBORw0KGgo=', counts: true });
  assert.equal(d.result.info.mime, 'image/png');
  assert.equal(run({ type: 'format', input: 'QUJD', opts: { datauri: true }, mime: 'text/plain' }).result.out, 'data:text/plain;base64,QUJD');
  const bad = run({ type: 'decode', input: 'QU*D', counts: true });
  assert.match(bad.error, /第 3 个字符/);
  assert.equal(bad.inputChars, 4);
});

test('PEM：标签可含连字符，折叠的头部续行不进入正文', () => {
  const pe = '-----BEGIN PRIVACY-ENHANCED MESSAGE-----\nQUJD\n-----END PRIVACY-ENHANCED MESSAGE-----';
  assert.deepEqual(bytes(core.decodeB64(pe)), Array.from(enc('ABC')));
  assert.throws(() => core.decodeB64(pe + '\n' + pe), /多个 PEM/);
  const folded = '-----BEGIN RSA PRIVATE KEY-----\r\nProc-Type: 4,ENCRYPTED\r\nDEK-Info: AES-128-CBC,\r\n 0123456789ABCDEF\r\n\r\nQUJD\r\n-----END RSA PRIVATE KEY-----';
  assert.deepEqual(bytes(core.decodeB64(folded)), Array.from(enc('ABC')));
  assert.deepEqual(bytes(core.decodeB64('-----BEGIN X-----QUJD-----END X-----')), Array.from(enc('ABC')));
});

test('解码：还原 JSON 转义，剥离 CSS url() 与裸 base64, 前缀', () => {
  const abcdef = Array.from(enc('ABCDEF'));
  assert.deepEqual(bytes(core.decodeB64('"QUJD\\nREVG"')), abcdef);
  const slash = Buffer.from([0xfb, 0xff, 0xbf]).toString('base64'); // "+/+/"
  assert.equal(slash, '+/+/');
  assert.deepEqual(bytes(core.decodeB64('"+\\/+\\/"')), [0xfb, 0xff, 0xbf]);
  assert.deepEqual(bytes(core.decodeB64('"QUJD\nREVG"')), abcdef);
  assert.deepEqual(core.decodeB64('url("data:text/plain;base64,QUJD")'), { bytes: enc('ABC'), mime: 'text/plain' });
  assert.deepEqual(core.decodeB64("url( 'data:text/plain;base64,QUJD' )"), { bytes: enc('ABC'), mime: 'text/plain' });
  assert.deepEqual(bytes(core.decodeB64('url(QUJD)')), Array.from(enc('ABC')));
  assert.deepEqual(bytes(core.decodeB64('base64,QUJD')), Array.from(enc('ABC')));
  // 无法按 JSON 解析的反斜杠仍然给出明确错误
  assert.throws(() => core.decodeB64('"QU\\xJD"'), /不是合法的 Base64 字符/);
});

test('safeFileName：设备名变体与超长文件名', () => {
  assert.equal(core.safeFileName('CON .txt', 'x'), '_CON .txt');
  assert.equal(core.safeFileName('com\u00b9.log', 'x'), '_com\u00b9.log');
  assert.equal(core.safeFileName('console.txt', 'x'), 'console.txt');
  assert.equal(core.safeFileName('a/b\\c:d', 'x'), 'a_b_c_d');
  assert.equal(core.safeFileName(' .. ', 'fallback'), 'fallback');
  const long = core.safeFileName('文'.repeat(300) + '.png', 'x');
  assert.ok(long.endsWith('.png'));
  assert.ok(Buffer.byteLength(long) <= 200);
  assert.equal(core.safeFileName('a'.repeat(300), 'x').length, 200);
  assert.equal(core.safeFileName('ok.txt', 'x'), 'ok.txt');
});
