/**
 * 验证 loading="lazy" 到底有没有生效。
 *
 *   node tools/check-lazy.js [url]
 *
 * 做法：干净地打开一次页面，完全不滚动，只等 3 秒，
 * 然后统计哪些图片已经发起请求。若视口外的图片也请求了，说明懒加载没起作用。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/';
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9337;
const userDataDir = path.join(os.tmpdir(), 'leafer-lazy-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
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

  // 干净打开一次，不做任何滚动
  await send('Page.navigate', { url: URL_ });
  await sleep(1200);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: URL_ });
  await sleep(3000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(3000);

  const result = await evaluate(`(() => {
    const origin = location.origin;
    const requested = new Set(
      performance.getEntriesByType('resource')
        .filter(r => r.initiatorType === 'img')
        .map(r => r.name.replace(origin + '/', ''))
    );
    const vh = window.innerHeight;
    const imgs = [...document.images].map(i => {
      const r = i.getBoundingClientRect();
      const src = i.getAttribute('src');
      return {
        src,
        loading: i.getAttribute('loading'),
        top: Math.round(r.top),
        inViewport: r.top < vh && r.bottom > 0,
        requested: requested.has(src),
        decoded: i.complete && i.naturalWidth > 0
      };
    });
    return { vh, imgs, scrollY: window.scrollY };
  })()`);

  console.log('\n  视口高度: ' + result.vh + 'px   当前滚动: ' + result.scrollY);
  console.log('\n  ' + 'loading'.padEnd(9) + 'top'.padEnd(9) + 'inView'.padEnd(9) + 'requested'.padEnd(11) + 'decoded'.padEnd(9) + 'src');
  console.log('  ' + '-'.repeat(78));
  let violations = 0;
  for (const i of result.imgs) {
    const bad = i.loading === 'lazy' && !i.inViewport && i.requested;
    if (bad) violations++;
    console.log('  ' + String(i.loading).padEnd(9) + String(i.top).padEnd(9)
      + String(i.inViewport).padEnd(9) + String(i.requested).padEnd(11)
      + String(i.decoded).padEnd(9) + i.src + (bad ? '   <== 视口外却已请求' : ''));
  }
  console.log('\n  懒加载违规数: ' + violations
    + (violations === 0 ? '  (全部正确延迟加载)' : '  *** 懒加载未生效 ***'));

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error(e.message); child.kill(); process.exit(1); });
