/**
 * 快速 DOM 诊断：查清"图片加载失败"具体是哪些元素。
 *
 *   node tools/diag.js [url]
 *
 * 输出每张图片的 src / 是否在视口内 / 是否被 display:none 隐藏 / 是否解码成功。
 * 用来区分"真的 404"和"因为 v-show 隐藏而尚未加载"，避免误判。
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
const PORT = 9334;
const userDataDir = path.join(os.tmpdir(), 'leafer-diag-' + Date.now());

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(250);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.addEventListener('open', res));

  let id = 0;
  const pending = new Map();
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
  await send('Page.navigate', { url: URL_ });
  await sleep(4000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  const rows = await evaluate(`(() => {
    return [...document.images].map(i => {
      const cs = getComputedStyle(i);
      return {
        src: i.getAttribute('src'),
        cls: i.className.split(' ').slice(0,2).join(' '),
        hidden: cs.display === 'none' || cs.visibility === 'hidden',
        loading: i.getAttribute('loading'),
        ok: i.complete && i.naturalWidth > 0,
        nw: i.naturalWidth
      };
    });
  })()`);

  console.log('\n  src'.padEnd(30) + 'loading'.padEnd(10) + 'hidden'.padEnd(9) + 'decoded');
  console.log('  ' + '-'.repeat(62));
  for (const r of rows) {
    console.log('  ' + String(r.src).padEnd(28)
      + String(r.loading).padEnd(10)
      + String(r.hidden).padEnd(9)
      + (r.ok ? 'OK ' + r.nw + 'px' : '*** 未解码 ***'));
  }

  const realBroken = rows.filter((r) => !r.ok && !r.hidden);
  console.log('\n  真正加载失败（可见且未解码）: ' + realBroken.length);
  realBroken.forEach((r) => console.log('     ✗ ' + r.src));

  // 轮播到下一张，确认隐藏的背景图会在展示时正常加载
  console.log('\n  等待背景轮播切换（9 秒）...');
  await sleep(9000);
  const bgState = await evaluate(`(() => {
    return [...document.querySelectorAll('img[alt=""]')].map(i => ({
      src: i.getAttribute('src'),
      hidden: getComputedStyle(i).display === 'none',
      ok: i.complete && i.naturalWidth > 0
    }));
  })()`);
  bgState.forEach((b) => console.log('     ' + (b.hidden ? '隐藏' : '显示')
    + '  ' + String(b.src).padEnd(22) + (b.ok ? '已解码' : '未加载')));

  ws.close();
  child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error(e.message); child.kill(); process.exit(1); });
