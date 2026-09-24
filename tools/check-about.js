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

  // 滚到底触发懒加载，然后**轮询等待图片真的解码完成**。
  // 不能靠固定 sleep：本地是缓存命中所以很快，线上要下载几百 KB，
  // 只等 2.5 秒会把"还在下载"误判成"图片损坏"（真发生过）。
  await evaluate(`window.scrollTo(0, document.body.scrollHeight); true`);
  // 逐张把图片滚进视口，再等它解码完成。
  // 之前用"滚到某个百分比然后固定等待"的做法不可靠：
  // 位置算不准时最后一张图始终没进过视口，就永远不会开始加载，
  // 于是被误判成"图片损坏"。滚动位置必须是明确的，不能靠算。
  const deadline = Date.now() + 30000;
  let pendingImgs = -1;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    // 让每一张图都真正进入过视口
    await evaluate(`(() => {
      const imgs = [...document.querySelectorAll('#main figure img')];
      imgs.forEach(i => { try { i.scrollIntoView({ block: 'center' }); } catch (e) {} });
      return imgs.length;
    })()`);
    await sleep(900);
    pendingImgs = await evaluate(`(() => {
      const imgs = [...document.querySelectorAll('#main figure img')];
      return imgs.filter(i => !(i.complete && i.naturalWidth > 0)).length;
    })()`);
    if (pendingImgs === 0) break;
  }
  console.log('\n  等待配图加载: '
    + (pendingImgs === 0 ? `全部就绪（第 ${round} 轮）` : `仍有 ${pendingImgs} 张未完成（超时）`));
  await evaluate(`window.scrollTo(0, 0); true`);
  await sleep(500);

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
