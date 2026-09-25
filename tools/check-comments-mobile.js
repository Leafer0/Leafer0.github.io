/**
 * 在"手机视角"下验证评论区能否正常使用。
 *
 *   node tools/check-comments-mobile.js [站点URL]
 *
 * 背景：桌面能评论、手机不能。可能是布局遮挡、表单没渲染、
 * 或提交请求被拦 —— 这几种原因的修法完全不同，必须先区分。
 *
 * 本脚本用 CDP 的移动端模拟（设 viewport、deviceScaleFactor、触摸、
 * 以及真实手机 UA）打开留言板，检查：
 *   1. 评论区是否渲染出来
 *   2. 输入框是否可见、可点击（没有被遮挡或移出视口）
 *   3. 提交按钮是否可见可点
 *   4. 是否存在横向溢出导致表单点不到
 * 全程只读，不实际提交任何内容。
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
const PORT = 9363;
const userDataDir = path.join(os.tmpdir(), 'leafer-mob-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一个常见的安卓手机 UA，确保页面走移动端分支
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=390,844', 'about:blank',
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
  const apiReqs = [];
  const reqUrls = new Map();
  const failures = [];
  const exceptions = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') {
      reqUrls.set(m.params.requestId, { url: m.params.request.url, method: m.params.request.method });
    }
    if (m.method === 'Network.loadingFailed') {
      const r = reqUrls.get(m.params.requestId) || {};
      failures.push(`${m.params.errorText}  ${r.method || ''} ${String(r.url || '').slice(0, 80)}`);
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // 开启移动端模拟：视口、缩放、触摸、UA
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });

  console.log('\n  ── 手机视角下的评论区 ──');
  console.log('  站点: ' + SITE);
  console.log('  UA:   Android Chrome (390x844, DPR3)\n');

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  const vp = await evaluate('({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: "ontouchstart" in window })');
  console.log('  视口: ' + vp.w + 'x' + vp.h + '  DPR=' + vp.dpr + '  触摸支持=' + vp.touch);

  // 进留言板
  const entered = await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('留言板'));
    if(!b) return false; b.click(); return true;
  })()`);
  console.log('  点击「留言板」入口: ' + entered);

  // 等评论区渲染
  let rendered = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    rendered = await evaluate(`document.querySelectorAll('[class^="wl-"]').length`);
    if (rendered > 0) break;
  }
  console.log('  评论区元素数: ' + rendered);

  // 检查表单各项是否可见可点
  const form = await evaluate(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 元素中心点是否真的能被点到（用 elementFromPoint 判断有无遮挡）
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight)
        ? document.elementFromPoint(cx, cy) : null;
      return {
        exists: true,
        w: Math.round(r.width), h: Math.round(r.height),
        top: Math.round(r.top),
        inViewport: r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        coveredBy: top && !el.contains(top) && top !== el
          ? (top.className || top.tagName).toString().slice(0, 60) : null
      };
    };
    return {
      nick: pick('.wl-header input[type="text"], input[name="nick"]'),
      mail: pick('input[type="email"], input[name="mail"]'),
      editor: pick('.wl-editor, textarea'),
      submit: pick('button[type="submit"], .wl-btn, button'),
      header: pick('.wl-header'),
      // 页面整体是否横向溢出（手机上常见问题）
      overflowX: document.documentElement.scrollWidth - innerWidth,
      wlCount: document.querySelectorAll('[class^="wl-"]').length
    };
  })()`);

  console.log('\n  ── 表单元素可点性 ──');
  for (const [name, info] of Object.entries(form)) {
    if (name === 'overflowX' || name === 'wlCount') continue;
    if (!info) { console.log(`    ${name.padEnd(8)} 不存在`); continue; }
    console.log(`    ${name.padEnd(8)} ${info.w}x${info.h}  top=${info.top}`
      + `  可见=${info.inViewport}  display=${info.display}`
      + (info.coveredBy ? `  ⚠ 被遮挡: ${info.coveredBy}` : ''));
  }
  console.log('\n  横向溢出: ' + form.overflowX + 'px'
    + (form.overflowX > 1 ? '   ⚠ 手机上会导致横向滚动、可能点不到表单' : '   正常'));

  console.log('\n  ── 网络：是否发出了 get 评论列表请求 ──');
  const apiCalls = await evaluate(`(() => performance.getEntriesByType('resource')
    .map(r => r.name).filter(n => n.includes('/api/comment'))
    .map(n => { try { return new URL(n).pathname + new URL(n).search; } catch(e) { return n; } })
    .filter((v,i,a) => a.indexOf(v) === i))()`);
  if (!apiCalls.length) console.log('    (无)');
  apiCalls.forEach((c) => console.log('    ' + c));

  if (failures.length) {
    console.log('\n  ── 失败的请求 ──');
    failures.slice(0, 8).forEach((f) => console.log('    ✗ ' + f));
  }
  if (exceptions.length) {
    console.log('\n  ── JS 异常 ──');
    exceptions.slice(0, 5).forEach((e) => console.log('    ✗ ' + e));
  }

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
