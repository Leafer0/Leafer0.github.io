/**
 * 一次性截图：干净地打开页面、进入、滚到指定位置截图。
 *
 *   node tools/shot.js [url] [输出名] [滚动像素|full]
 *
 * screenshot.js 是全流程回归用的，会切主题、开灯箱，出图不一定是你想看的状态。
 * 这个脚本只做一件事：给你一张指定位置的干净截图，方便肉眼校对排版。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/';
const NAME = process.argv[3] || 'shot';
const SCROLL = process.argv[4] || '0';
const OUT = path.resolve(__dirname, '..', '.preview');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9339;
const userDataDir = path.join(os.tmpdir(), 'leafer-shot-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,1000', 'about:blank',
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
  const evaluate = async (expr) => (await send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true,
  })).result.value;

  await send('Page.enable');
  await send('Runtime.enable');
  // 固定用浅色，方便和深色截图对照
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  fs.mkdirSync(OUT, { recursive: true });

  await send('Page.navigate', { url: URL_ });
  await sleep(1500);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: URL_ });
  await sleep(4000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  if (SCROLL === 'full') {
    const h = await evaluate(`document.body.scrollHeight`);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: Math.min(h, 16000), deviceScaleFactor: 1, mobile: false,
    });
    await sleep(1500);
  } else {
    const y = Number(SCROLL) || 0;
    await evaluate(`window.scrollTo(0, ${y}); true`);
    await sleep(2000);
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, NAME + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('  截图: ' + file + '  (' + (fs.statSync(file).size / 1024).toFixed(0) + ' KB)');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error(e.message); child.kill(); process.exit(1); });
