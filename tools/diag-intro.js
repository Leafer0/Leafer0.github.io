/**
 * 同时采集控制台错误与多帧截图，用于定位"入场页空白"这类问题。
 *
 *   node tools/diag-intro.js [站点URL] [输出目录]
 *
 * 为什么把两件事放一起：入场页空白可能是"元素没渲染"、
 * 也可能是"渲染了但被动画停在透明状态"，只看截图分不出。
 * 把控制台输出与不同时刻的画面一并采集，才能判断。
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
const PORT = 9377;
const userDataDir = path.join(os.tmpdir(), 'leafer-dintro-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
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

  const msgs = [];
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      msgs.push('[' + m.params.type + '] ' + (m.params.args || [])
        .map((a) => a.value || a.description || '').join(' ').slice(0, 300));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      msgs.push('[异常] ' + String((d.exception && d.exception.description) || d.text).split('\n')[0]);
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

  fs.mkdirSync(OUT, { recursive: true });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(1000);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: SITE + '/' });

  console.log('\n  ── 逐时刻观察入场页状态 ──\n');
  console.log('   时刻 | #app可见 | 入场元素 | 草木数 | opacity | 标题文字');
  for (const ms of [300, 700, 1200, 1800, 2500, 3500, 5000]) {
    await sleep(ms === 300 ? 300 : 0);
    if (ms > 300) await sleep(0);
    // 用绝对时间去等，避免累加误差
    const st = await evaluate(`(() => {
      const app = document.getElementById('app');
      const intro = document.querySelector('.intro-botanical');
      const veil = document.querySelector('.intro-veil');
      const title = document.querySelector('.shimmer-text');
      const appCS = app ? getComputedStyle(app) : null;
      return {
        appDisplay: appCS ? appCS.display : 'no-app',
        appOpacity: appCS ? appCS.opacity : '-',
        hasIntroRoot: !!document.querySelector('[aria-label="点击进入 Leafer\\'s Garden"]'),
        botCount: document.querySelectorAll('.intro-botanical').length,
        veilOpacity: veil ? getComputedStyle(veil).opacity : '-',
        introOpacity: intro ? getComputedStyle(intro).opacity : '-',
        title: title ? title.textContent.trim().slice(0, 24) : '(无)',
        bodyText: document.body.innerText.replace(/\\n+/g, ' ').slice(0, 60)
      };
    })()`);
    if (st && st.__err) { console.log('   ' + ms + 'ms  求值失败: ' + st.__err); continue; }
    console.log(`  ${String(ms).padStart(4)}ms | ${st.appDisplay.padEnd(8)} | `
      + `${String(st.hasIntroRoot).padEnd(8)} | ${String(st.botCount).padStart(6)} | `
      + `${String(st.introOpacity).padEnd(7)} | ${st.title}`);
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'diag-intro-final.png'), Buffer.from(data, 'base64'));
  console.log('\n  最终截图: .preview/diag-intro-final.png');

  console.log('\n  ── 控制台 ──\n');
  if (!msgs.length) console.log('  (无输出)');
  msgs.slice(0, 20).forEach((m) => console.log('  ' + m));

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
