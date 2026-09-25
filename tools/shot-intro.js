/**
 * 按时间轴截取入场动画的各个阶段。
 *
 *   node tools/shot-intro.js [站点URL] [输出目录]
 *
 * 为什么需要专门做：
 *   tools/shot.js 会先按 Enter 跳过入场页，所以拿不到入场动画的画面。
 *   而入场动画是一次性的时序动画，必须**在指定时刻**截图才能评估效果。
 *   这里不按 Enter，按 0.3/0.9/1.4/1.9/2.6 秒逐帧截取。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve(__dirname, '..', '.preview');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9375;
const userDataDir = path.join(os.tmpdir(), 'leafer-intro-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 逐帧时刻（毫秒，从页面开始渲染入场页算起）
const FRAMES = [300, 900, 1400, 1900, 2600];

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-color-profile=srgb',
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
    return r.result.value;
  };

  fs.mkdirSync(OUT, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  // 关键：显式声明"不减少动态效果"。
  // 否则若系统开着「减少动态效果」（Windows 的动画开关 / macOS 的减弱动态效果），
  // 页面里那条 @media (prefers-reduced-motion: reduce) 会把所有动画压到 0.01ms，
  // 于是每一帧拍到的都是终态、看上去"动画没跑"。
  // 这是无障碍特性在正常工作，不是 bug —— 但会让截图工具失去意义，
  // 所以这里覆盖它，仅为采集动画过程。
  await send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  });

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(1200);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: SITE + '/' });

  // 等入场页**真正渲染完成**再开始计时。
  // 关键是等到标题文字不再是未编译的 {{ }} —— 只看元素存在不够：
  // 元素在 Vue 挂载前就已存在于 HTML 里，那时开始计时拍到的全是白屏
  // （这个坑真实踩过：前 4 帧全是 5KB 的空白图）。
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    ready = await evaluate(`(() => {
      const t = document.querySelector('.shimmer-text');
      return !!t && t.textContent.indexOf('{{') === -1 && t.textContent.trim().length > 0;
    })()`);
    if (ready) break;
  }
  if (!ready) {
    console.error('  入场页未在 6 秒内渲染完成，放弃截图');
    ws.close(); child.kill();
    process.exit(1);
  }
  console.log('\n  ── 入场动画逐帧截图 ──\n');

  const t0 = Date.now();
  for (const ms of FRAMES) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, 'intro-' + String(ms).padStart(4, '0') + 'ms.png');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  ${String(ms).padStart(4)}ms  ->  ${path.basename(file)}`);
  }

  console.log('');
  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
