/**
 * 模拟真人在手机上评论的完整交互：点昵称栏 → 输入 → 点输入框 → 输入 → 点提交。
 *
 *   node tools/test-comment-interaction-mobile.js [站点URL]
 *
 * 为什么需要它：
 *   前面只验证了"表单元素可见可点"（几何位置检查），
 *   但"能不能真的输入进去、提交按钮点下去有没有反应"是另一回事 ——
 *   移动端常见问题包括：输入法把焦点抢走、触摸事件被上层元素吞掉、
 *   Waline 内部状态没跟上导致提交按钮无效等。
 *   这些只有模拟真实交互才能发现。
 *
 * 用 CDP 的 Input.dispatchKeyEvent / Input.dispatchTouchEvent 发真实事件，
 * 而不是用 JS 直接改 value（那样绕过了事件处理，测不出问题）。
 *
 * 注意：会真的创建一条带标记的评论，方便在后台删除。
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
const PORT = 9367;
const userDataDir = path.join(os.tmpdir(), 'leafer-int-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

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
  const handlers = new Map();
  const postResponses = [];
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
    if (/\/api\/comment/.test(p.response.url) && p.response.status !== 200) {
      postResponses.push(p.response.status + ' ' + p.response.url.slice(0, 70));
    }
  });

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA });

  console.log('\n  ── 手机端完整交互测试 ──');
  console.log('  站点: ' + SITE + '   视口 390x844 DPR3 触摸\n');

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 进入留言板
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('留言板'));
    if(b) b.click(); return !!b;
  })()`);

  // 等评论区
  let wl = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    wl = await evaluate(`document.querySelectorAll('[class^="wl-"]').length`);
    if (wl > 0) break;
  }
  console.log('  评论区元素数: ' + wl);

  // 滚动到输入框
  await evaluate(`(() => {
    const el = document.querySelector('.wl-editor, textarea');
    if (el) el.scrollIntoView({ block: 'center' });
    return !!el;
  })()`);
  await sleep(600);

  /** 用真实触摸点击某元素的中心 */
  async function tap(selector, label) {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    if (!box) { console.log(`  ✗ ${label}: 找不到元素 ${selector}`); return false; }
    for (const type of ['touchStart', 'touchEnd']) {
      await send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchStart' ? [{ x: box.x, y: box.y }] : [],
      });
      await sleep(60);
    }
    console.log(`  ✓ ${label}: 已触摸 (${box.x},${box.y}) 尺寸 ${box.w}x${box.h}`);
    return true;
  }

  /** 逐字符输入（走真实键盘事件） */
  async function typeText(text) {
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
      await send('Input.dispatchKeyEvent', { type: 'keyUp' });
      await sleep(15);
    }
  }

  // 1. 点昵称栏并输入
  await tap('input[name="nick"]', '点击昵称栏');
  await sleep(400);
  await typeText('手机自检');
  await sleep(400);
  const nickVal = await evaluate(`(document.querySelector('input[name="nick"]') || {}).value || ''`);
  console.log('  昵称栏实际值: ' + JSON.stringify(nickVal));

  // 2. 点输入框并输入评论内容
  await tap('.wl-editor, textarea', '点击评论输入框');
  await sleep(400);
  const marker = '手机交互测试-' + Date.now();
  await typeText(marker);
  await sleep(400);
  const editorVal = await evaluate(`(() => {
    const t = document.querySelector('textarea');
    const e = document.querySelector('.wl-editor');
    return t ? t.value : (e ? e.innerText : '');
  })()`);
  console.log('  输入框实际值: ' + JSON.stringify(String(editorVal).slice(0, 60)));

  // 3. 点提交
  const tapped = await tap('button[type="submit"], .wl-btn.primary, .wl-btn', '点击提交按钮');
  await sleep(4000);

  // 4. 结果
  const after = await evaluate(`(() => {
    const base = location.origin;
    return {
      textareaEmpty: (() => {
        const t = document.querySelector('textarea');
        return t ? t.value.trim() === '' : null;
      })(),
      pageHasMarker: document.body.innerText.includes(${JSON.stringify(marker)}),
      errText: (document.querySelector('.wl-error, [class*="error"]') || {}).innerText || ''
    };
  })()`);

  console.log('\n  ── 交互结果 ──');
  console.log('  提交后输入框是否被清空: ' + after.textareaEmpty + '（清空通常代表提交成功）');
  console.log('  页面上是否出现刚发的内容: ' + after.pageHasMarker);
  if (after.errText) console.log('  页面错误提示: ' + after.errText.slice(0, 120));
  if (postResponses.length) {
    console.log('  非 200 的接口响应:');
    postResponses.slice(0, 5).forEach((p) => console.log('    ' + p));
  }

  const ok = (nickVal.length > 0) && String(editorVal).trim().length > 0 && tapped;
  console.log('\n  ── 结论 ──');
  console.log('  手机端输入可用 : ' + (nickVal.length > 0 && String(editorVal).trim().length > 0 ? '是' : '否'));
  console.log('  提交按钮可点   : ' + (tapped ? '是' : '否'));
  console.log('  提交是否成功   : ' + (after.pageHasMarker ? '是' : '未能确认（见上方提示）'));
  console.log('\n  清理：登录 Waline 后台删除昵称「手机自检」的评论\n');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('测试失败: ' + e.message); child.kill(); process.exit(1); });
