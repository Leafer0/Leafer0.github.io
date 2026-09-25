/**
 * 描述访客在评论区实际能看到什么。
 *
 *   node tools/describe-comment-ux.js [站点URL]
 *
 * 用途：确认"访客要填哪些项""匿名评论是否可用""有没有登录入口"，
 * 以及这些是否和 data.json 里的 comments 配置一致。
 * 只看界面，不会提交任何评论。
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
const PORT = 9355;
const userDataDir = path.join(os.tmpdir(), 'leafer-ux-' + Date.now());
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 进入"帖子"页
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(1200);

  // 展开第一篇文章
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));
    if(b) b.click(); return !!b;
  })()`);

  // 等评论区渲染（冷启动可能几秒）
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    ready = await evaluate(`document.querySelectorAll('[class^="wl-"]').length > 0`);
    if (ready) break;
  }
  console.log('\n  评论区渲染: ' + (ready ? '已出现' : '未出现（超时）'));

  const info = await evaluate(`(() => {
    const sec = [...document.querySelectorAll('section')].find(s => /评论/.test(s.textContent));
    const scope = sec || document;
    const inputs = [...scope.querySelectorAll('input, textarea')].map(el => ({
      tag: el.tagName.toLowerCase(),
      type: el.type || '',
      name: el.getAttribute('name') || el.getAttribute('placeholder') || '',
      placeholder: el.getAttribute('placeholder') || '',
      required: el.hasAttribute('required') || el.getAttribute('data-required') === 'true'
    }));
    const btns = [...scope.querySelectorAll('button')].map(b => (b.textContent || '').trim()).filter(Boolean);
    return {
      inputs,
      buttons: [...new Set(btns)].slice(0, 12),
      text: scope.innerText.replace(/\\n+/g, ' | ').slice(0, 420)
    };
  })()`);

  console.log('\n  ── 访客看到的输入项 ──');
  if (!info.inputs.length) console.log('    (没有输入框)');
  info.inputs.forEach((i) => {
    console.log(`    ${i.tag}${i.type ? '[' + i.type + ']' : ''}  ${i.placeholder || i.name}${i.required ? '   (必填)' : ''}`);
  });
  console.log('\n  ── 按钮 ──');
  info.buttons.forEach((b) => console.log('    ' + b));
  console.log('\n  ── 区域文字 ──');
  console.log('    ' + info.text);

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
