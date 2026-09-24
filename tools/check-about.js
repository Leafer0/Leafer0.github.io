/**
 * 验证"关于我"页面是否正确渲染了 data.js 里的段落。
 *
 *   node tools/check-about.js [url]
 *
 * 数据改了但页面没渲染对是最容易漏的问题（比如 type 写错、画廊图片缺 src），
 * 这里把 data.js 的预期和 DOM 实际渲染结果逐项对照。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/';
const ROOT = path.resolve(__dirname, '..');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9338;
const userDataDir = path.join(os.tmpdir(), 'leafer-about-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 预期值：直接从 data.js 里算出来
/**
 * 读取页面实际使用的数据源。
 * 页面优先读 data.json（富文本后台 /admin 就是改它），读不到才回退 data.js。
 * 所以这里也必须优先读 JSON，否则两边一旦不同步，校验就会给出错误结论。
 */
function loadSiteData() {
  const jsonPath = path.join(ROOT, 'data.json');
  if (fs.existsSync(jsonPath)) {
    return { data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')), from: 'data.json' };
  }
  return {
    data: eval(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8') + '\n;SITE_DATA'),
    from: 'data.js',
  };
}
const loaded = loadSiteData();
console.log('\n  预期数据来源: ' + loaded.from);
const SITE_DATA = loaded.data;
const paras = SITE_DATA.about.paragraphs;
const expect = {
  headings: paras.filter((p) => p.type === 'heading').map((p) => p.value),
  texts: paras.filter((p) => p.type === 'text').map((p) => p.value),
  images: paras.filter((p) => p.type === 'gallery').flatMap((g) => g.images.map((i) => i.src)),
  galleryCount: paras.filter((p) => p.type === 'gallery').length,
};

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

(async () => {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.addEventListener('open', res));
  let id = 0; const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(4000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(2000);
  await evaluate(`window.scrollTo(0, document.body.scrollHeight); true`);
  await sleep(2500); // 等懒加载图片就位

  const dom = await evaluate(`(() => {
    const section = document.querySelector('[key="about"], #main > div');
    const headings = [...document.querySelectorAll('#main h1, #main h2')].map(h => h.textContent.trim());
    const figures = [...document.querySelectorAll('#main figure')];
    const imgs = [...document.querySelectorAll('#main figure img')];
    return {
      headings,
      textBlocks: [...document.querySelectorAll('#main p')].map(p => p.textContent.trim()),
      figureCount: figures.length,
      imgSrcs: imgs.map(i => i.getAttribute('src')),
      imgBroken: imgs.filter(i => !(i.complete && i.naturalWidth > 0)).map(i => i.getAttribute('src')),
      captions: [...document.querySelectorAll('#main figcaption')].map(f => f.textContent.trim())
    };
  })()`);

  let pass = 0, fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  };

  console.log('\n  ── 关于我 渲染检查 ──\n');

  const missingHeadings = expect.headings.filter((h) => !dom.headings.includes(h));
  check('小标题全部渲染', missingHeadings.length === 0,
    missingHeadings.length ? '缺少: ' + missingHeadings.join('、') : expect.headings.join(' / '));

  const missingTexts = expect.texts.filter(
    (t) => !dom.textBlocks.some((b) => b.includes(t.slice(0, 12)))
  );
  check('正文段落全部渲染（' + expect.texts.length + ' 段）', missingTexts.length === 0,
    missingTexts.length ? '缺少 ' + missingTexts.length + ' 段，首段: ' + missingTexts[0].slice(0, 24) : '全部匹配');

  check('配图组数量正确', dom.figureCount === expect.images.length,
    '预期 ' + expect.images.length + ' 张，实际 ' + dom.figureCount + ' 张 figure');

  const missingImgs = expect.images.filter((s) => !dom.imgSrcs.includes(s));
  check('配图路径全部匹配', missingImgs.length === 0,
    missingImgs.length ? '缺少: ' + missingImgs.join(', ') : expect.images.length + ' 张');

  check('配图全部解码成功', dom.imgBroken.length === 0,
    dom.imgBroken.length ? '损坏: ' + dom.imgBroken.join(', ') : '0 张损坏');

  check('图片说明文字齐全', dom.captions.length === expect.images.length,
    dom.captions.join(' / '));

  check('无 JS 异常', errors.length === 0, errors.length ? errors[0].split('\n')[0] : '无');

  console.log('\n  ── 结果: ' + pass + ' 通过, ' + fail + ' 失败 ──\n');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
