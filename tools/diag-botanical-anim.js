/**
 * 检查入场动画中草木纹样的类名与计算样式。
 *
 *   node tools/diag-botanical-anim.js [站点URL]
 *
 * 用于定位"描边生长/叶片绽放动画没跑"的原因：
 * 先确认类名是否真的加上了，再看动画属性是否被应用、是否被别的规则覆盖。
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
const PORT = 9383;
const userDataDir = path.join(os.tmpdir(), 'leafer-bot-' + Date.now());
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
      return { __err: String((d.exception && d.exception.description) || d.text).split('\n')[0] };
    }
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(1000);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: SITE + '/' });

  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const r = await evaluate(`(() => {
      const t = document.querySelector('.shimmer-text');
      return !!t && t.textContent.indexOf('{{') === -1;
    })()`);
    if (r) break;
  }

  const info = await evaluate(`(() => {
    const svg = document.querySelector('.intro-botanical svg') || document.querySelector('.intro-botanical');
    if (!svg) return { err: '找不到纹样元素' };
    const stroke = svg.querySelector('.bot-stroke');
    const fill = svg.querySelector('.bot-fill');
    const cs = (el) => el ? getComputedStyle(el) : null;
    const dump = (el, name) => {
      const s = cs(el);
      if (!s) return name + ': (不存在)';
      return {
        name: name,
        className: el.getAttribute ? el.getAttribute('class') : '',
        animationName: s.animationName,
        animationDuration: s.animationDuration,
        animationDelay: s.animationDelay,
        animationFillMode: s.animationFillMode,
        strokeDasharray: s.strokeDasharray,
        strokeDashoffset: s.strokeDashoffset,
        opacity: s.opacity,
        transform: s.transform
      };
    };
    return {
      svgClass: svg.getAttribute('class'),
      svgTag: svg.tagName,
      stroke: dump(stroke, 'stroke'),
      fill: dump(fill, 'fill'),
      strokeCount: svg.querySelectorAll('.bot-stroke').length,
      fillCount: svg.querySelectorAll('.bot-fill').length
    };
  })()`);

  if (info.__err || info.err) { console.log('\n  ' + (info.__err || info.err) + '\n'); }
  else {
    console.log('\n  ── 纹样元素状态 ──\n');
    console.log('  SVG 标签: ' + info.svgTag);
    console.log('  SVG class: ' + info.svgClass);
    console.log('  .bot-stroke 数量: ' + info.strokeCount + '   .bot-fill 数量: ' + info.fillCount);
    console.log('');
    for (const k of ['stroke', 'fill']) {
      const d = info[k];
      console.log('  [' + k + '] class="' + d.className + '"');
      console.log('        animation-name     = ' + d.animationName);
      console.log('        animation-duration = ' + d.animationDuration);
      console.log('        animation-delay    = ' + d.animationDelay);
      console.log('        fill-mode          = ' + d.animationFillMode);
      console.log('        dasharray/dashoffset = ' + d.strokeDasharray + ' / ' + d.strokeDashoffset);
      console.log('        opacity            = ' + d.opacity);
      console.log('');
    }
  }

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
