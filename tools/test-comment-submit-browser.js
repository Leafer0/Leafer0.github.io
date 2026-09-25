/**
 * 用"浏览器自己的 fetch"测试评论提交（POST）。
 *
 *   node tools/test-comment-submit-browser.js [站点URL]
 *
 * 为什么不用 Node / PowerShell 直接请求：
 *   本机 Node 对 Vercel 的请求会被链路层重置，PowerShell 也时通时断，
 *   两者都会给出"提交失败"的**错误结论**。而浏览器能稳定通信。
 *   更重要的是：浏览器路径才是访客真实走的那条路 ——
 *   包括同源策略、预检、Content-Type 等，都由浏览器按真实规则处理。
 *
 * 关键：优先在**线上站点**上执行，这样 Origin 就是真实来源，
 *       CORS 行为与访客完全一致；本地执行则通过 CDP 注入跨域头绕过限制。
 *
 * 注意：会真的创建一条带标记的评论，方便在后台找到并删除。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'https://leafersgarden.xyz/').replace(/\/$/, '');
const TEST_PATH = '/guestbook';
const isLocal = /127\.0\.0\.1|localhost/.test(SITE);

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9365;
const userDataDir = path.join(os.tmpdir(), 'leafer-sub-' + Date.now());
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
  const netlog = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method && handlers.has(m.method)) handlers.get(m.method).forEach((f) => f(m.params));
  });
  const on = (method, fn) => {
    if (!handlers.has(method)) handlers.set(method, []);
    handlers.get(method).push(fn);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(String((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // 本地站点不在 Waline 的 SERVER_URL 白名单里，用 CDP 注入跨域头以便测量
  if (isLocal) {
    await send('Fetch.enable', { patterns: [{ urlPattern: '*waline*', requestStage: 'Response' }] });
    on('Fetch.requestPaused', async (p) => {
      const h = (p.responseHeaders || []).filter((x) => !/^access-control-/i.test(x.name));
      h.push({ name: 'Access-Control-Allow-Origin', value: SITE });
      h.push({ name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' });
      h.push({ name: 'Access-Control-Allow-Headers', value: '*' });
      try {
        await send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: p.responseStatusCode || 200, responseHeaders: h,
        });
      } catch { try { await send('Fetch.continueRequest', { requestId: p.requestId }); } catch {} }
    });
  }

  on('Network.responseReceived', (p) => {
    if (/\/api\/comment/.test(p.response.url)) {
      netlog.push(p.response.requestHeadersText ? '' : '');
      netlog.push(`${p.response.status}  ${p.response.url.slice(0, 90)}`);
    }
  });
  on('Network.loadingFailed', (p) => {
    netlog.push(`FAILED ${p.errorText}`);
  });

  console.log('\n  ── 用浏览器 fetch 测试评论提交 ──');
  console.log('  站点: ' + SITE + (isLocal ? '  （本地，已注入跨域头）' : '  （线上，Origin 与访客一致）'));
  console.log('');

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  const serverURL = await evaluate(
    `fetch('data.json').then(r => r.json()).then(j => j.comments.serverURL)`
  );
  console.log('  Waline 地址: ' + serverURL);

  const marker = '自动测试-' + Date.now();
  const result = await evaluate(`(async () => {
    const base = ${JSON.stringify(serverURL)};
    const marker = ${JSON.stringify(marker)};
    const out = { preflight: null, post: null, readback: null };

    // 1) 真实提交（浏览器会按同源策略自行处理预检）
    const t0 = Date.now();
    try {
      const res = await fetch(base + '/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          comment: marker + '（可删除）',
          nick: '链路自检',
          mail: '',
          link: '',
          ua: navigator.userAgent,
          url: ${JSON.stringify(TEST_PATH)}
        })
      });
      out.post = { status: res.status, ms: Date.now() - t0, body: (await res.text()).slice(0, 200) };
    } catch (e) {
      out.post = { error: String(e && e.message || e), ms: Date.now() - t0 };
    }

    // 2) 读回来确认
    try {
      const res = await fetch(base + '/api/comment?path=' + encodeURIComponent(${JSON.stringify(TEST_PATH)})
        + '&pageSize=50&sortBy=insertedAt_desc', { credentials: 'omit' });
      const j = await res.json();
      const found = (j.data && j.data.data || []).some(c => String(c.comment || '').includes(marker));
      out.readback = { status: res.status, count: j.data && j.data.count, found: found };
    } catch (e) {
      out.readback = { error: String(e && e.message || e) };
    }
    return out;
  })()`);

  console.log('\n  ── 提交结果 ──');
  if (result.post.error) {
    console.log('  ❌ 提交失败: ' + result.post.error + '  (' + result.post.ms + 'ms)');
  } else {
    console.log('  HTTP ' + result.post.status + '  (' + result.post.ms + 'ms)');
    console.log('  响应: ' + result.post.body);
  }

  console.log('\n  ── 读回确认 ──');
  if (result.readback.error) {
    console.log('  读取失败: ' + result.readback.error);
  } else {
    console.log('  当前评论条数 = ' + result.readback.count
      + '   刚提交的那条' + (result.readback.found ? ' ✅ 已存在' : ' ⚠ 未找到（可能开了审核，或写入被拒）'));
  }

  const ok = result.post && !result.post.error
    && result.post.status >= 200 && result.post.status < 300;
  console.log('\n  ── 结论 ──');
  console.log('  评论提交链路: ' + (ok ? '可用（HTTP ' + result.post.status + '）' : '不可用'));
  if (ok && result.readback && !result.readback.found) {
    console.log('  注：写入成功但列表里看不到，通常是服务端开了评论审核（COMMENT_AUDIT），');
    console.log('      需要到 ' + serverURL + '/ui 后台审核通过后才公开显示。');
  }
  console.log('\n  清理：登录 ' + serverURL + '/ui 删除内容含「' + marker + '」的评论\n');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('测试失败: ' + e.message); child.kill(); process.exit(1); });
