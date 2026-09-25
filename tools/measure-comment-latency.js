/**
 * 测量"从浏览器发起到 Waline 服务端返回"的真实耗时。
 *
 *   node tools/measure-comment-latency.js [本地站点URL] [Waline地址]
 *
 * 为什么需要它：
 *   评论区挂载前会先探测服务是否可达（避免服务被墙时留一个坏框子）。
 *   这个探测有个超时值，设得太短会把"服务只是慢"误判成"不可达"，
 *   导致评论区被错误隐藏 —— 而本地预览又因为 CORS 根本连不上，
 *   分不出"超时太短"和"服务有问题"。
 *
 *   所以这里用 CDP 把跨域响应头改写成允许当前来源，
 *   让本地页面能真的连上线上 Waline，从而量出冷启动的真实耗时。
 *
 * 注意：注入 CORS 头仅用于**测量**，不改变线上服务的任何配置。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const WALINE = process.argv[3] || 'https://waline.leafersgarden.xyz';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9353;
const userDataDir = path.join(os.tmpdir(), 'leafer-lat-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
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

  let id = 0; const pending = new Map();
  const handlers = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method && handlers.has(m.method)) handlers.get(m.method).forEach((f) => f(m.params));
  });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(fn);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(method + ' 超时')); } }, 40000);
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
    return r.result.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // ---- 用 CDP 代理请求，把跨域响应头改写成允许当前来源 ----
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*waline*', requestStage: 'Response' }],
  });
  const origin = SITE;
  let patched = 0;
  on('Fetch.requestPaused', async (p) => {
    const hdrs = (p.responseHeaders || []).filter(
      (h) => !/^access-control-/i.test(h.name)
    );
    hdrs.push({ name: 'Access-Control-Allow-Origin', value: origin });
    hdrs.push({ name: 'Access-Control-Allow-Credentials', value: 'false' });
    hdrs.push({ name: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS' });
    hdrs.push({ name: 'Access-Control-Allow-Headers', value: '*' });
    patched++;
    try {
      await send('Fetch.fulfillRequest', {
        requestId: p.requestId,
        responseCode: p.responseStatusCode || 200,
        responseHeaders: hdrs,
        body: p.responseStatusCode === 204 ? undefined : undefined,
      });
    } catch {
      try { await send('Fetch.continueRequest', { requestId: p.requestId }); } catch {}
    }
  });

  console.log('\n  ── 测量 Waline 响应耗时 ──');
  console.log('  站点: ' + SITE);
  console.log('  Waline: ' + WALINE);
  console.log('  （已通过 CDP 注入 CORS 头，仅用于本次测量）\n');

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4000);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 直接量三次真实请求（含首次冷启动）
  const results = await evaluate(`(async () => {
    const url = ${JSON.stringify(WALINE)} + '/api/comment?path=' + encodeURIComponent('/thoughts/0');
    const out = [];
    for (let i = 1; i <= 3; i++) {
      const t0 = performance.now();
      try {
        const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
        const t = Math.round(performance.now() - t0);
        const body = await res.text();
        let errno = null;
        try { errno = JSON.parse(body).errno; } catch (e) {}
        out.push({ n: i, ok: res.ok, ms: t, errno });
      } catch (e) {
        out.push({ n: i, ok: false, ms: Math.round(performance.now() - t0), err: String(e.message || e) });
      }
    }
    return out;
  })()`);

  console.log('  第1次(冷启动) : ' + JSON.stringify(results[0]));
  console.log('  第2次         : ' + JSON.stringify(results[1]));
  console.log('  第3次(热)     : ' + JSON.stringify(results[2]));
  console.log('\n  拦截并改写的响应数: ' + patched);

  const cold = results[0] && results[0].ms;
  const TIMEOUT = 8000; // 与 index.html 里的 COMMENT_PROBE_TIMEOUT 保持一致
  console.log('\n  ── 结论 ──');
  if (cold == null) {
    console.log('  无法测得耗时');
  } else if (cold > TIMEOUT) {
    console.log(`  冷启动耗时 ${cold}ms > 当前超时 ${TIMEOUT}ms`);
    console.log('  → 评论区会被误隐藏，需要继续放宽超时或优化服务。');
  } else {
    console.log(`  冷启动耗时 ${cold}ms，在 ${TIMEOUT}ms 超时内 —— 探测不会误判。`);
    console.log(`  （热态约 ${results[2] ? results[2].ms : '?'}ms）`);
  }
  if (cold > 1500) {
    console.log(`  注：最初设的 1500ms 超时明显不足 —— 服务正常也会被判定为不可达，`);
    console.log(`      这正是评论区一度被错误隐藏的原因。`);
  }
  console.log('');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('测量失败: ' + e.message); child.kill(); process.exit(1); });
