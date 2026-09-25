/**
 * 诊断"服务不可达时评论区是否被隐藏"。
 *
 *   node tools/diag-fallback.js [本地站点URL]
 *
 * 背景：check-comments-fallback.js 报"仍存在的容器: [waline-thread-0]"，
 * 但容器是空的（0 个可见元素）、也没有"加载中/失败"提示 ——
 * 说明探针回调似乎根本没跑。这个脚本用 CDP 观察调用序列，定位卡在哪。
 *
 * 做法：临时把 data.json 的 serverURL 指向必然连不通的地址，
 * 加载页面后展开文章，逐秒记录 DOM 与状态，测完还原。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const UNREACHABLE = 'https://comments.invalid';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9361;
const userDataDir = path.join(os.tmpdir(), 'leafer-dfb-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backup = fs.readFileSync(DATA, 'utf8');
function setServerURL(url) {
  const d = JSON.parse(backup);
  d.comments.serverURL = url;
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + '\n', 'utf8');
}

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1400,1000', 'about:blank',
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
  const consoleMsgs = [];
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const t = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      consoleMsgs.push(`[${m.params.type}] ${t.slice(0, 160)}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push(String((d.exception && d.exception.description) || d.text).split('\n')[0]);
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
      throw new Error(String((d.exception && d.exception.description) || d.text).split('\n')[0]);
    }
    return r.result.value;
  };

  try {
    setServerURL(UNREACHABLE);
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('\n  ── 诊断：服务不可达时的评论区行为 ──');
    console.log('  serverURL 临时设为: ' + UNREACHABLE + '\n');

    await send('Page.navigate', { url: SITE + '/' });
    await sleep(1500);
    await evaluate(`localStorage.clear(); true`);
    await send('Page.navigate', { url: SITE + '/' });
    await sleep(4500);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
    await sleep(1500);

    // 切到帖子页
    await evaluate(`(() => {
      const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
      if(b) b.click(); return !!b;
    })()`);
    await sleep(1500);
    console.log('  已切到帖子页');

    // 展开文章
    const expanded = await evaluate(`(() => {
      const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));
      if(!b) return false; b.click(); return true;
    })()`);
    console.log('  展开文章: ' + expanded);

    // 逐秒观察 12 秒
    console.log('\n  秒 | 容器数 | 可见wl元素 | 加载中 | 失败提示 | 正文长度');
    for (let s = 1; s <= 12; s++) {
      await sleep(1000);
      const st = await evaluate(`(() => ({
        containers: document.querySelectorAll('[id^="waline-thread-"], #waline-guestbook').length,
        wl: document.querySelectorAll('[class^="wl-"]').length,
        loading: /评论加载中/.test(document.body.innerText),
        error: /评论加载失败/.test(document.body.innerText),
        bodyLen: document.body.innerText.length
      }))()`);
      console.log(`  ${String(s).padStart(2)} | ${String(st.containers).padStart(6)} | ${String(st.wl).padStart(9)} | ${st.loading ? '是' : '否'}     | ${st.error ? '是' : '否'}     | ${st.bodyLen}`);
    }

    console.log('\n  ── 控制台 ──');
    if (!consoleMsgs.length) console.log('    (无)');
    consoleMsgs.slice(0, 15).forEach((m) => console.log('    ' + m));
    if (exceptions.length) {
      console.log('  ── 异常 ──');
      exceptions.slice(0, 5).forEach((e) => console.log('    ' + e));
    }
  } finally {
    fs.writeFileSync(DATA, backup, 'utf8');
    console.log('\n  已还原 data.json\n');
    ws.close(); child.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
})().catch((e) => {
  try { fs.writeFileSync(DATA, backup, 'utf8'); } catch {}
  console.error('诊断失败: ' + e.message);
  child.kill();
  process.exit(1);
});
