/**
 * 验证"留言板"（全站共用的评论区）是否正常工作。
 *
 *   node tools/check-guestbook.js [站点URL]
 *
 * 与 check-comments.js 的区别：
 *   check-comments.js 测的是"每篇文章一条评论线"，
 *   这里测的是侧边栏「留言板」页 —— 所有访客共用同一个 Waline path。
 *
 * 要确认的点：
 *   1. 侧边栏出现「留言板」入口，点击能进入
 *   2. 留言板页渲染出评论区
 *   3. 它请求的 path 是 /guestbook（而不是某篇文章的 path）
 *   4. 从文章评论切到留言板时，旧实例被销毁（不残留、不串数据）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'https://leafersgarden.xyz/').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const configured = !!(cfg.comments && cfg.comments.serverURL);

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9359;
const userDataDir = path.join(os.tmpdir(), 'leafer-gb-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,1100', 'about:blank',
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
  const apiPaths = new Set();
  const reqUrls = new Map();
  const exceptions = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') reqUrls.set(m.params.requestId, m.params.request.url);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
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

  console.log('\n  ── 留言板检查 ──\n');
  console.log('  站点: ' + BASE + '    评论配置: ' + (configured ? '已启用' : '未启用') + '\n');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1500);
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 1. 侧边栏是否有留言板入口
  const navInfo = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('nav[aria-label="主导航"] button')];
    return { items: btns.map(b => b.textContent.trim()), hasGuestbook: btns.some(b => /留言板/.test(b.textContent)) };
  })()`);
  check(navInfo.hasGuestbook, '侧边栏有「留言板」入口', navInfo.items.join(' / '));

  // 2. 先看文章评论，再切到留言板 —— 验证切换时旧实例被销毁
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(1200);
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(configured ? 10000 : 2000);
  const inArticle = await evaluate(`document.querySelectorAll('[class^="wl-"]').length`);
  if (configured) check(inArticle > 0, '文章评论区已渲染', inArticle + ' 个元素');

  // 切到留言板
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('留言板'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(configured ? 10000 : 2000);

  const gb = await evaluate(`(() => {
    const h1 = document.querySelector('#main h1');
    const box = document.getElementById('waline-guestbook');
    // 顺便抓一下页面上我们自己输出的诊断信息，便于定位"为什么没渲染"
    return {
      heading: h1 ? h1.textContent.trim() : null,
      containerExists: !!box,
      wlCount: document.querySelectorAll('[class^="wl-"]').length,
      // 文章页的容器 id 形如 waline-thread-N，留言板是 waline-guestbook
      threadContainers: document.querySelectorAll('[id^="waline-thread-"]').length,
      text: (box ? box.innerText : '').replace(/\\n+/g, ' | ').slice(0, 140),
      // 页面上显示的加载/错误提示（模板里有对应元素）
      bodyHint: (document.getElementById('main') || {}).innerText
        ? [...(document.getElementById('main').innerText.match(/评论加载中|评论加载失败|留言板/g) || [])].join(',')
        : ''
    };
  })()`);

  // 若没渲染，直接读页面上暴露的调试信息（window.__gbDebug）
  const diag = await evaluate(`(() => ({
    gbDebug: window.__gbDebug || null,
    hasContainerNow: !!document.getElementById('waline-guestbook'),
    wlAny: document.querySelectorAll('[class^="wl-"]').length,
    loadingText: /评论加载中/.test(document.body.innerText),
    errorText: /评论加载失败/.test(document.body.innerText)
  }))()`);

  check(gb.heading === '留言板', '已进入留言板页', '标题=' + gb.heading);
  check(gb.containerExists, '留言板容器存在', gb.containerExists ? 'waline-guestbook' : '未找到');
  check(gb.threadContainers === 0, '文章评论区实例已销毁（不残留）',
    gb.threadContainers ? gb.threadContainers + ' 个残留' : '0 个');
  if (configured) {
    check(gb.wlCount > 0, '留言板评论区已渲染', gb.wlCount + ' 个元素');
    console.log('        区域文字: ' + gb.text);
    if (gb.wlCount === 0) {
      console.log('        诊断: 容器=' + diag.hasContainerNow
        + '  加载中=' + diag.loadingText
        + '  失败提示=' + diag.errorText);
      console.log('        __gbDebug = ' + JSON.stringify(diag.gbDebug));
    }
  }

  // 3. 请求的 path 是否为 /guestbook
  const paths = await evaluate(`(() => {
    return performance.getEntriesByType('resource')
      .map(r => r.name)
      .filter(n => n.includes('/api/comment'))
      .map(n => { try { return new URL(n).searchParams.get('path'); } catch(e) { return null; } })
      .filter(Boolean)
      .filter((v,i,a) => a.indexOf(v) === i);
  })()`);
  check(paths.includes('/guestbook'), '留言板请求的 path 是 /guestbook',
    '出现过的 path: ' + (paths.join(', ') || '无'));

  // 4. 切回帖子页后留言板实例应被销毁
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(1500);
  const back = await evaluate(`(() => ({
    guestbookBox: !!document.getElementById('waline-guestbook'),
    wlCount: document.querySelectorAll('[class^="wl-"]').length
  }))()`);
  check(!back.guestbookBox, '离开留言板后容器已移除',
    back.guestbookBox ? '仍存在' : '已移除');

  check(exceptions.length === 0, '无未捕获 JS 异常',
    exceptions.length ? exceptions[0] : '无');

  console.log(`\n  ── 结果: ${pass} 通过, ${fail} 失败 ──\n`);

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
