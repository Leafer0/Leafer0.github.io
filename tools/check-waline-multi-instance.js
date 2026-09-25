/**
 * 验证同一个页面上能否挂载两个 Waline 实例，且各自读写不同的 path。
 *
 *   node tools/check-waline-multi-instance.js [站点URL]
 *
 * 为什么需要验证：
 *   要给站点加"集体留言板"，最直接的想法是在新页面再挂一个 Waline 实例。
 *   但如果 Waline 的第 2 个实例无法独立工作（例如共用全局状态、
 *   或被第一实例的 DOM 选择器干扰），就会出现留言板读不到/写到别处的问题。
 *   这种事必须实测，不能假设。
 *
 * 本脚本在页面里手动创建两个容器，分别用 path=/guestbook 与 path=/thoughts/0，
 * 检查：
 *   1. 两个实例是否都渲染出界面
 *   2. 各自发出的请求是否带上了正确的 path
 * 纯只读操作，不提交任何内容。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'https://leafersgarden.xyz/').replace(/\/$/, '');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9357;
const userDataDir = path.join(os.tmpdir(), 'leafer-wmi-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1400,1100', 'about:blank',
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
  const apiCalls = [];
  const allReq = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') allReq.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Network.loadingFailed') {
      apiCalls.push({ failed: m.params.errorText, url: (allReq.get(m.params.requestId) || '').slice(0, 90) });
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    // 注意：CDP 的异常字段在返回值顶层（exceptionDetails），
    // 不在 result 里面。取错字段会让真实错误被吞成含糊的 "Uncaught"。
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      throw new Error(String(desc).split('\n')[0]);
    }
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  const serverURL = await evaluate(
    `fetch('data.json').then(r => r.json()).then(j => j.comments.serverURL)`
  );
  console.log('\n  服务地址: ' + serverURL);

  console.log('\n  ── 在页面上创建两个 Waline 实例 ──');
  const made = await evaluate(`(async () => {
    const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
    const a = mk('probe-article');
    const b = mk('probe-guestbook');
    const base = {
      serverURL: ${JSON.stringify(serverURL)},
      lang: 'zh-CN',
      pageSize: 10,
      login: 'enable',
      requiredMeta: ['nick'],
      pageview: false,
      reaction: false,
      emoji: false,
      search: false,
      imageUploader: false,
      dark: 'html.dark',
      search: false
    };
    window.__inst = [];
    window.__err = [];
    try {
      window.__inst.push(window.Waline.init(Object.assign({}, base, { el: a, path: '/thoughts/0' })));
    } catch (e) { window.__err.push('article: ' + e.message); }
    try {
      window.__inst.push(window.Waline.init(Object.assign({}, base, { el: b, path: '/guestbook' })));
    } catch (e) { window.__err.push('guestbook: ' + e.message); }
    return { count: window.__inst.length, err: window.__err };
  })()`);
  console.log('  创建实例数: ' + made.count + '   错误: ' + JSON.stringify(made.err));

  // 等两个实例各自发请求
  await sleep(9000);

  const state = await evaluate(`(() => {
    const q = (sel) => document.querySelectorAll(sel).length;
    return {
      articleWl: q('#probe-article [class^="wl-"]'),
      guestbookWl: q('#probe-guestbook [class^="wl-"]'),
      articleText: (document.getElementById('probe-article') || {}).innerText || '',
      guestbookText: (document.getElementById('probe-guestbook') || {}).innerText || ''
    };
  })()`);

  console.log('\n  ── 渲染结果 ──');
  console.log('  文章实例 wl- 元素数 : ' + state.articleWl);
  console.log('  留言板实例 wl- 元素数: ' + state.guestbookWl);
  console.log('  文章实例文字: ' + state.articleText.replace(/\n+/g, ' | ').slice(0, 130));
  console.log('  留言板文字  : ' + state.guestbookText.replace(/\n+/g, ' | ').slice(0, 130));

  console.log('\n  ── 服务端请求（看 path 是否各自正确）──');
  const calls = await evaluate(`(() => {
    return performance.getEntriesByType('resource')
      .map(r => r.name)
      .filter(n => n.includes('/api/'))
      .map(n => { try { return decodeURIComponent(new URL(n).search); } catch(e) { return n; } })
      .filter((v, i, a) => a.indexOf(v) === i);
  })()`);
  calls.forEach((c) => console.log('    ' + c));
  if (apiCalls.length) {
    console.log('\n  ── 失败的请求 ──');
    apiCalls.slice(0, 5).forEach((f) => console.log('    ✗ ' + JSON.stringify(f)));
  }

  const ok = state.articleWl > 0 && state.guestbookWl > 0;
  const paths = calls.join(' ');
  const hasBoth = paths.includes('/guestbook') && paths.includes('/thoughts/0');
  console.log('\n  ── 结论 ──');
  console.log('  两个实例都能渲染      : ' + (ok ? '是' : '否'));
  console.log('  各自请求了不同的 path : ' + (hasBoth ? '是' : '否（需检查）'));
  console.log('');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(ok && hasBoth ? 0 : 1);
})().catch((e) => { console.error('验证失败: ' + e.message); child.kill(); process.exit(1); });
