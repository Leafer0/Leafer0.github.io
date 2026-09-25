/**
 * 用浏览器解析来验证 HTML 结构（比手写正则可靠）。
 *
 *   node tools/check-html-structure.js [本地站点URL]
 *
 * 为什么改用它：
 *   先用正则写了一个"标签配平检查器"，结果报出 48 处问题，
 *   其中大量是明显正常的标签（如 <button> 内嵌 <span v-html>）——
 *   是那个检查器的正则处理不了"属性值里含 >"的情况，属于工具自身有 bug。
 *   浏览器才是权威的 HTML 解析器：让它解析、再检查 DOM 是否如预期，
 *   比我自己写解析器可靠得多。
 *
 * 检查项：
 *   1. Vue 是否成功挂载（结构错乱常导致挂载失败）
 *   2. 四个页面能否相互切换且标题正确（结构错乱常导致某页空白）
 *   3. 页面关键元素数量是否符合预期
 *   4. 是否有未捕获异常
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
const PORT = 9371;
const userDataDir = path.join(os.tmpdir(), 'leafer-html-' + Date.now());
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
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
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

  let pass = 0, fail = 0;
  const check = (ok, name, detail) => {
    if (ok) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  };

  console.log('\n  ── HTML 结构与页面渲染 ──\n');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: SITE + '/' });
  await sleep(4500);

  // Vue 是否挂载（结构错乱最常见的后果就是挂载失败）
  const mounted = await evaluate(`!!document.querySelector('nav[aria-label="主导航"] button')`);
  check(mounted, 'Vue 正常挂载', mounted ? '找到导航按钮' : '导航未渲染 —— 模板可能有结构错误');
  if (!mounted) {
    console.log('\n  未挂载，无法继续检查页面内容。');
    ws.close(); child.kill();
    process.exit(1);
  }

  // 入场页
  const intro = await evaluate(`(() => {
    const el = document.querySelector('.intro-botanical');
    const rule = document.querySelector('.intro-rule');
    const skip = [...document.querySelectorAll('button')].some(b => /跳过动画/.test(b.textContent));
    return {
      botCount: document.querySelectorAll('.intro-botanical').length,
      hasRule: !!rule,
      hasSkip: skip,
      title: (document.querySelector('.shimmer-text') || {}).textContent || ''
    };
  })()`);
  check(intro.botCount === 4, '入场页有四角草木纹样', intro.botCount + ' 个');
  check(intro.hasRule, '入场页有生长细线');
  check(intro.hasSkip, '入场页有「跳过动画」按钮');
  check(intro.title.length > 0, '入场页标题可见', JSON.stringify(intro.title.trim()));

  // 进入站点
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 逐页检查：结构错乱最容易表现为"某页空白"
  const pages = [
    { name: '关于我', expect: '我是谁' },
    { name: '心流', expect: '过去与未来' },
    { name: '帖子', expect: '我的帖子' },
    { name: '留言板', expect: '留言板' },
  ];
  for (const pg of pages) {
    const clicked = await evaluate(`(() => {
      const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes(${JSON.stringify(pg.name)}));
      if(!b) return false; b.click(); return true;
    })()`);
    await sleep(1200);
    const state = await evaluate(`(() => {
      const h1 = document.querySelector('#main h1');
      const frame = document.querySelector('.garden-frame');
      const corners = document.querySelectorAll('.garden-corner').length;
      return {
        h1: h1 ? h1.textContent.trim() : null,
        hasFrame: !!frame,
        corners: corners,
        bodyLen: document.getElementById('main').innerText.length
      };
    })()`);
    check(clicked && state.h1 && state.h1.includes(pg.expect),
      pg.name + ' 页标题正确', 'h1=' + state.h1);
    check(state.hasFrame, pg.name + ' 页有花园边框',
      state.hasFrame ? (state.corners + ' 个角饰') : '未找到 .garden-frame');
  }

  check(exceptions.length === 0, '无未捕获 JS 异常',
    exceptions.length ? exceptions[0] : '无');

  console.log(`\n  ── 结果: ${pass} 通过, ${fail} 失败 ──\n`);

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
