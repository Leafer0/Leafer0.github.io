/**
 * 抓取页面加载时的控制台输出与异常，用于定位 Vue 挂载失败的原因。
 *
 *   node tools/diag-console.js [站点URL]
 *
 * 为什么需要它：Vue 模板编译失败时不会让页面白屏报错，
 * 而是往控制台打一条警告然后放弃挂载 —— 界面上只表现为"什么都没渲染"。
 * 必须把控制台内容抓出来才能看到真正的原因。
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
const PORT = 9373;
const userDataDir = path.join(os.tmpdir(), 'leafer-con-' + Date.now());
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

  const msgs = [];
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || [])
        .map((a) => a.value || a.description || (a.preview && JSON.stringify(a.preview)) || '')
        .join(' ');
      msgs.push({ level: m.params.type, text });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      msgs.push({
        level: 'EXCEPTION',
        text: String((d.exception && (d.exception.description || d.exception.value)) || d.text),
      });
    }
  });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(6000);

  console.log('\n  ── 页面控制台输出 ──\n');
  if (!msgs.length) {
    console.log('  (无输出)');
  } else {
    msgs.forEach((m) => {
      const tag = m.level === 'EXCEPTION' ? '异常' : m.level;
      console.log(`  [${tag}] ${m.text.slice(0, 600)}`);
      console.log('');
    });
  }

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
