/**
 * 逐步诊断评论区的挂载过程。
 *
 *   node tools/diag-comments.js [url]
 *
 * 背景：check-comments.js 出现 "CDP 超时: Runtime.evaluate"，
 * 说明页面主线程被卡住或渲染陷入循环。
 * 这个脚本把每一步拆开、每步都单独超时，并打印页面内部状态，
 * 用来定位到底卡在哪一步 —— 而不是靠猜。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9345;
const userDataDir = path.join(os.tmpdir(), 'leafer-diagc-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
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
  const log = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const t = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      log.push(`[console:${m.params.type}] ${t.slice(0, 200)}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      log.push(`[异常] ${(d.exception?.description || d.text || '').split('\n')[0].slice(0, 240)}`);
    }
    if (m.method === 'Page.loadEventFired') log.push('[事件] load 事件触发');
    if (m.method === 'Page.domContentEventFired') log.push('[事件] DOMContentLoaded');
  });

  /** 带超时的调用：超时只报错，不挂死 */
  function call(method, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) {
          pending.delete(i);
          reject(new Error(`${method} 超时(${timeout}ms)`));
        }
      }, timeout);
    });
  }

  async function evaluate(label, expr, timeout = 15000) {
    process.stdout.write(`  ${label.padEnd(42)}`);
    try {
      const r = await call('Runtime.evaluate', {
        expression: expr, awaitPromise: false, returnByValue: true,
      }, timeout);
      if (r.result && r.result.exceptionDetails) {
        console.log('页面内异常: ' + r.result.exceptionDetails.text);
        return null;
      }
      const v = r.result && r.result.result ? r.result.result.value : undefined;
      console.log('OK  ' + (v === undefined ? '' : JSON.stringify(v).slice(0, 160)));
      return v;
    } catch (e) {
      console.log('*** ' + e.message);
      return null;
    }
  }

  await call('Page.enable');
  await call('Runtime.enable');

  console.log('\n  ── 分步诊断 ──\n');

  await call('Page.navigate', { url: BASE + '/' }, 20000).catch((e) => console.log('  导航: ' + e.message));
  await sleep(4000);

  await evaluate('1. 页面是否可响应', '1+1');
  await evaluate('2. Vue 是否挂载', '!!document.querySelector("nav[aria-label=\\"主导航\\"]")');
  await evaluate('3. Waline 全局是否存在', 'typeof window.Waline');
  await evaluate('4. Waline 版本', '(window.Waline||{}).version');
  await evaluate('5. commentsReady 相关 DOM', 'document.querySelectorAll("section").length');

  // 进入站点
  await evaluate('6. 触发进入', 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"})),1');
  await sleep(1500);

  // 切到帖子页
  await evaluate('7. 点击"帖子"导航', `(()=>{const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));if(!b)return 'no-btn';b.click();return 'clicked';})()`);
  await sleep(1500);

  await evaluate('8. 帖子页是否渲染', 'document.querySelectorAll("article").length');

  // 展开第一篇文章 —— 这一步会挂载 Waline，是怀疑的重点
  await evaluate('9. 点击"阅读全文"', `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));if(!b)return 'no-btn';b.click();return 'clicked';})()`);

  console.log('\n  展开后逐秒观察（等 12 秒）:');
  for (let s = 1; s <= 12; s++) {
    await sleep(1000);
    const r = await evaluate(`  第${s}秒 可响应性`, 'document.querySelectorAll("[class^=\\"wl-\\"]").length', 6000);
    if (r === null) {
      console.log('     ^^^ 主线程在此刻起不可响应，问题定位到这一秒内发生的事');
      break;
    }
  }

  console.log('\n  ── 页面日志 ──');
  if (!log.length) console.log('    (无)');
  log.slice(0, 25).forEach((l) => console.log('    ' + l));

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('诊断失败: ' + e.message); child.kill(); process.exit(1); });
