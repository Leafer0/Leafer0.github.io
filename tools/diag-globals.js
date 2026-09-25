/**
 * 检查页面里关键全局变量与脚本加载情况。
 *
 *   node tools/diag-globals.js [站点URL]
 *
 * 用于定位"Vue 不挂载且控制台无报错"这类问题：
 * 逐个确认每个 <script> 引入的全局是否真的存在，
 * 以及内联启动脚本是否执行到了挂载那一步。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9379;
const userDataDir = path.join(os.tmpdir(), 'leafer-glob-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1200,900', 'about:blank',
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

  const reqs = new Map();
  const failed = [];
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.loadingFailed') {
      failed.push((reqs.get(m.params.requestId) || '?') + '  -> ' + m.params.errorText);
    }
    if (m.method === 'Network.responseReceived') {
      const u = m.params.response.url;
      if (/\.(js|css)(\?|$)/.test(u) && m.params.response.status >= 400) {
        failed.push(u + '  -> HTTP ' + m.params.response.status);
      }
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      return { __err: String((d.exception && d.exception.description) || d.text).split('\n')[0] };
    }
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(6000);

  const g = await evaluate(`(() => ({
    Vue: typeof window.Vue,
    SITE_DATA: typeof window.SITE_DATA,
    icon: typeof window.icon,
    botanical: typeof window.botanical,
    BOTANICAL: typeof window.BOTANICAL,
    Waline: typeof window.Waline,
    // 启动脚本是否留了失败提示（说明它跑到了某一分支）
    appHTML: (document.getElementById('app') || {}).innerHTML
      ? document.getElementById('app').innerHTML.slice(0, 90) : '(空)',
    appDisplay: getComputedStyle(document.getElementById('app')).display,
    hasVueApp: !!document.getElementById('app').__vue_app__
  }))()`);

  console.log('\n  ── 全局变量 ──\n');
  if (g.__err) { console.log('  求值失败: ' + g.__err); }
  else {
    console.log('  Vue         : ' + g.Vue);
    console.log('  SITE_DATA   : ' + g.SITE_DATA);
    console.log('  icon        : ' + g.icon);
    console.log('  botanical   : ' + g.botanical);
    console.log('  BOTANICAL   : ' + g.BOTANICAL);
    console.log('  Waline      : ' + g.Waline);
    console.log('  #app display: ' + g.appDisplay);
    console.log('  Vue 已挂载   : ' + g.hasVueApp);
    console.log('  #app 内容前 90 字: ' + g.appHTML);
  }

  console.log('\n  ── 加载失败或 4xx/5xx 的资源 ──\n');
  if (!failed.length) console.log('  (无)');
  failed.forEach((f) => console.log('  ✗ ' + f));

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
