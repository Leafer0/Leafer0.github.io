/**
 * 列出留言板上实际的评论（用于确认提交结果 + 找出测试数据）。
 *
 *   node tools/list-comments.js [站点URL] [path]
 *
 * 用浏览器执行读取，因为本机 Node / PowerShell 对 Vercel 的连接时通时断，
 * 会给出"查询失败"的错误结论。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'https://leafersgarden.xyz/').replace(/\/$/, '');
const TARGET_PATH = process.argv[3] || '/guestbook';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9369;
const userDataDir = path.join(os.tmpdir(), 'leafer-list-' + Date.now());
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
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(String((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);

  const out = await evaluate(`(async () => {
    const result = { steps: [] };
    const base = (await (await fetch('data.json')).json()).comments.serverURL;
    result.base = base;
    // 单次请求可能因冷启动超时，重试两次
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(base + '/api/comment?path=' + encodeURIComponent(${JSON.stringify(TARGET_PATH)})
          + '&pageSize=50&sortBy=insertedAt_desc', { credentials: 'omit', signal: ctrl.signal });
        clearTimeout(timer);
        result.steps.push('attempt' + attempt + ': HTTP ' + res.status);
        if (!res.ok) { lastErr = 'HTTP ' + res.status; continue; }
        const j = await res.json();
        result.count = j.data && j.data.count;
        result.items = (j.data && j.data.data || []).map(c => ({
          id: c.objectId, nick: c.nick, when: c.insertedAt, status: c.status,
          text: String(c.comment || '').replace(/<[^>]+>/g, '').slice(0, 70)
        }));
        lastErr = null;
        break;
      } catch (e) {
        clearTimeout(timer);
        lastErr = String(e && e.message || e);
        result.steps.push('attempt' + attempt + ': ' + lastErr);
      }
    }
    result.error = lastErr;
    return result;
  })()`);

  if (out.error) {
    console.log('\n  ── 读取失败 ──');
    console.log('  服务: ' + (out.base || '(未取到)'));
    out.steps.forEach((s) => console.log('    ' + s));
    console.log('');
    ws.close(); child.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
  }

  console.log('\n  ── ' + TARGET_PATH + ' 的评论（共 ' + out.count + ' 条）──');
  console.log('  服务: ' + out.base + '\n');
  if (!out.items.length) console.log('  (无)');
  out.items.forEach((c) => {
    console.log(`  [${c.id}] ${c.nick}  ${c.when}  status=${c.status}`);
    console.log(`        ${c.text}`);
  });
  console.log('');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
