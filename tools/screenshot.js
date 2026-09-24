/**
 * 用 Chrome DevTools Protocol 对站点做一次真实的浏览器渲染检查。
 *
 *   node tools/screenshot.js [url] [出图目录]
 *
 * 做四件事：
 *   1. 收集控制台报错与请求失败（资源 404、JS 异常）
 *   2. 检查图片是否真的解码成功（naturalWidth > 0），而不只是"请求成功"
 *   3. 逐页截图（关于我 / 心流 / 帖子），浅色 + 深色
 *   4. 输出首屏资源体积统计
 *
 * 依赖：本机已安装 Edge 或 Chrome。使用 Node 内置 WebSocket，无需额外依赖。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/';
const OUT = process.argv[3] || path.resolve(__dirname, '..', '.preview');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const browserPath = BROWSERS.find((p) => fs.existsSync(p));
if (!browserPath) {
  console.error('找不到 Edge / Chrome，无法截图。');
  process.exit(1);
}

const PORT = 9333;
const userDataDir = path.join(os.tmpdir(), 'leafer-cdp-' + Date.now());

const child = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + userDataDir,
  '--window-size=1440,900',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  throw new Error('等待浏览器调试端口超时');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        this.handlers.get(msg.method).forEach((fn) => fn(msg.params));
      }
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 45000);
    });
  }
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function shot(cdp, name, fullPage) {
  const params = { format: 'png' };
  if (fullPage) params.captureBeyondViewport = true;
  const { data } = await cdp.send('Page.captureScreenshot', params);
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  截图  ${name}.png  (${kb} KB)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const wsUrl = await getTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const cdp = new CDP(ws);
  const consoleErrors = [];
  const jsExceptions = [];
  const failedRequests = [];

  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') {
      consoleErrors.push(`[${p.type}] ` + p.args.map((a) => a.value || a.description || '').join(' '));
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    jsExceptions.push(d.exception?.description || d.text);
  });
  cdp.on('Network.loadingFailed', (p) => {
    failedRequests.push(`${p.type} ${p.errorText}`);
  });
  cdp.on('Network.responseReceived', (p) => {
    if (p.response.status >= 400) {
      failedRequests.push(`HTTP ${p.response.status}  ${p.response.url}`);
    }
  });
  cdp.on('Log.entryAdded', (p) => {
    if (p.entry.level === 'error') {
      failedRequests.push(`[log] ${p.entry.text} ${p.entry.url || ''}`);
    }
  });

  // 记录首屏传输量（用 loadingFinished 的 encodedDataLength，无需取 body）
  let bytes = 0;
  const byType = {};
  const byUrl = [];
  cdp.on('Network.loadingFinished', async (p) => {
    bytes += p.encodedDataLength || 0;
    if (p.encodedDataLength > 0) byUrl.push(p.encodedDataLength);
  });
  cdp.on('Network.responseReceived', (p) => {
    byType[p.type] = (byType[p.type] || 0) + 1;
  });

  console.log('\n  加载 ' + URL_);
  // 先访问一次并清掉 localStorage，保证每次验证都从"未选择过主题"的干净状态开始。
  // （否则上一轮写入的 leafer-theme 会让主题判定的断言错位）
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(1500);
  await evaluate(cdp, `localStorage.clear(); true`);
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(4500); // 等 CDN 的 Vue 与字体、背景图就位

  // ---- 首屏真实体积（只看本站同源资源，排除第三方统计与我脚本自己的额外刷新） ----
  const payload = await evaluate(cdp, `(() => {
    const origin = location.origin;
    const rows = performance.getEntriesByType('resource')
      // 注意：缓存命中的资源 transferSize 会是 0，
      // 因此这里用 decodedBodySize 兜底，否则二次访问时会统计不到任何资源
      .filter(r => r.name.startsWith(origin) && (r.transferSize > 0 || r.decodedBodySize > 0))
      .map(r => {
        const decoded = Math.round((r.decodedBodySize || 0) / 1024);
        const cached = r.transferSize === 0;
        return {
          url: r.name.replace(origin + '/', ''),
          // transferSize 是压缩后的真实传输量（GitHub Pages 会开 gzip/brotli）
          kb: cached ? decoded : Math.round(r.transferSize / 1024),
          decoded,
          cached
        };
      });
    const total = rows.reduce((s, r) => s + r.kb, 0);
    const decodedTotal = rows.reduce((s, r) => s + r.decoded, 0);
    rows.sort((a, b) => b.kb - a.kb);
    return {
      total, decodedTotal, rows,
      cachedCount: rows.filter(r => r.cached).length
    };
  })()`);

  console.log('\n  ── 首屏本站资源体积 ──');
  console.log('  实测传输: ' + (payload.total / 1024).toFixed(2) + ' MB'
    + '    解码后: ' + (payload.decodedTotal / 1024).toFixed(2) + ' MB'
    + '    （' + payload.rows.length + ' 个请求，其中 '
    + payload.cachedCount + ' 个命中缓存）');
  payload.rows.slice(0, 12).forEach((r) =>
    console.log('     ' + String(r.kb).padStart(6) + ' KB  '
      + (r.decoded && r.decoded !== r.kb ? '(' + r.decoded + ' KB 解码后) ' : '')
      + r.url));


  // 检查图片前先滚一遍页面，触发懒加载。
  // 页面用 loading="lazy"，视口外的图本来就不会下载，
  // 不滚动就统计会把"还没轮到加载"误报成"加载失败"（曾误报 3 张）。
  await evaluate(cdp, `window.scrollTo(0, document.body.scrollHeight); true`);
  await sleep(3500);
  await evaluate(cdp, `window.scrollTo(0, 0); true`);
  await sleep(600);

  const health = await evaluate(cdp, `(() => {
    const vueMounted = !!document.querySelector('#app').__vue_app__ ||
                       !!document.querySelector('nav[aria-label="主导航"] button');
    const imgs = [...document.images].map(i => ({
      src: i.currentSrc.split('/').slice(-1)[0],
      ok: i.complete && i.naturalWidth > 0,
      w: i.naturalWidth
    }));
    const broken = imgs.filter(i => !i.ok);
    return {
      vueMounted,
      introVisible: !!document.querySelector('button[aria-label]'),
      navCount: document.querySelectorAll('nav[aria-label="主导航"] button').length,
      imageTotal: imgs.length,
      imageBroken: broken,
      iconsRendered: document.querySelectorAll('svg[aria-hidden="true"]').length,
      bodyScrollHeight: document.body.scrollHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mainCount: document.querySelectorAll('main').length,
      h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null
    };
  })()`);

  console.log('\n  ── 健康检查 ──');
  console.log('  Vue 挂载:        ' + (health.vueMounted ? 'OK' : '*** 失败 ***'));
  console.log('  导航项数量:      ' + health.navCount);
  console.log('  内联 SVG 图标数: ' + health.iconsRendered);
  console.log('  <main> 数量:     ' + health.mainCount + (health.mainCount === 1 ? '  (正确)' : '  *** 应为 1 ***'));
  console.log('  图片:            ' + health.imageTotal + ' 张，失败 ' + health.imageBroken.length + ' 张');
  if (health.imageBroken.length) health.imageBroken.forEach((b) => console.log('     ✗ ' + b.src));
  const overflow = health.docScrollWidth - health.viewportWidth;
  console.log('  横向溢出:        ' + (overflow > 1 ? '*** ' + overflow + 'px ***' : '无'));

  // 进入站点
  await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1800);
  await evaluate(cdp, `window.scrollTo(0,0); true`);

  console.log('\n  ── 截图 ──');
  await shot(cdp, '01-about-light', false);

  for (const [page, label] of [['journey', '02-journey'], ['thoughts', '03-thoughts']]) {
    await evaluate(cdp, `(() => {
      const btns=[...document.querySelectorAll('nav[aria-label="主导航"] button')];
      const b=btns.find(x=>x.textContent.includes(${JSON.stringify(
        { journey: '心流', thoughts: '帖子' }[page]
      )}));
      if(b) b.click();
      return !!b;
    })()`);
    await sleep(900);
    await shot(cdp, label + '-light', false);
  }

  // 展开第一篇帖子，检查图片懒加载与灯箱
  const expanded = await evaluate(cdp, `(() => {
    const btn=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('阅读全文'));
    if(!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(2200);
  await shot(cdp, '04-article-expanded', false);

  // 帖子卡片的实际底色与文字对比度（原来卡片是透明的，正文压在照片上几乎看不清）
  const contrast = await evaluate(cdp, `(() => {
    const el=document.querySelector('article');
    const bg=getComputedStyle(el).backgroundColor;
    const parts=bg.replace('rgba(','').replace('rgb(','').replace(')','').split(',').map(s=>s.trim());
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    const h2=el.querySelector('h2');
    const p=el.querySelector('p');
    return {
      cardBg: bg,
      alpha: isNaN(alpha) ? 1 : alpha,
      titleColor: h2 ? getComputedStyle(h2).color : 'n/a',
      summaryColor: p ? getComputedStyle(p).color : 'n/a'
    };
  })()`);
  console.log('\n  帖子卡片底色: ' + contrast.cardBg + '  不透明度=' + contrast.alpha
    + '  标题色=' + contrast.titleColor + '  正文色=' + contrast.summaryColor);
  console.log('  卡片是否有实底: ' + (contrast.alpha > 0.3 ? 'OK（正文不再压在照片上）' : '*** 仍然透明 ***'));

  const articleImgs = await evaluate(cdp, `(() => {
    return [...document.querySelectorAll('article img')].map(i => ({
      src: i.currentSrc.split('/').slice(-1)[0], ok: i.complete && i.naturalWidth>0
    }));
  })()`);
  console.log('\n  帖子配图: ' + JSON.stringify(articleImgs));

  // 灯箱
  const lightbox = await evaluate(cdp, `(() => {
    const b=document.querySelector('article button[aria-label="放大查看图片"]');
    if(!b) return false; b.click(); return true;
  })()`);
  await sleep(700);
  const lightboxOpen = await evaluate(cdp, `!!document.querySelector('[role="dialog"][aria-modal="true"]')`);
  console.log('  灯箱可打开: ' + (lightboxOpen ? 'OK' : '*** 失败 ***'));
  if (lightboxOpen) await shot(cdp, '05-lightbox', false);
  await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true`);
  await sleep(500);

  // ---- 主题切换与持久化 ----
  // 不假设系统偏好（本机可能就是深色），只验证：
  // 文案与当前状态对应 -> 点击后状态翻转 -> 落盘 -> 刷新后保持
  const themeBtn = () => `([...document.querySelectorAll('button')].find(b=>/模式/.test(b.textContent))||{})`;
  const before = await evaluate(cdp, `(() => {
    const b=${themeBtn()};
    return { dark: document.documentElement.classList.contains('dark'), label: b.textContent.trim() };
  })()`);
  const expectLabel = before.dark ? '浅色模式' : '深色模式';
  console.log('\n  初始主题: ' + (before.dark ? '深色' : '浅色')
    + '  按钮文案="' + before.label + '"  ' + (before.label === expectLabel ? 'OK' : '*** 文案不符 ***'));

  await evaluate(cdp, `(() => { const b=${themeBtn()}; if(b.click) b.click(); return true; })()`);
  await sleep(900);
  const after = await evaluate(cdp, `(() => {
    const b=${themeBtn()};
    return {
      dark: document.documentElement.classList.contains('dark'),
      label: b.textContent.trim(),
      stored: localStorage.getItem('leafer-theme'),
      themeColor: document.querySelector('meta[name="theme-color"]').content
    };
  })()`);
  const flipped = after.dark !== before.dark;
  const storedOk = after.stored === (after.dark ? 'dark' : 'light');
  console.log('  点击后: ' + (after.dark ? '深色' : '浅色') + '  ' + (flipped ? 'OK（已切换）' : '*** 未切换 ***')
    + '  localStorage=' + after.stored + '  ' + (storedOk ? 'OK' : '*** 未落盘 ***')
    + '  theme-color=' + after.themeColor + '  文案="' + after.label + '"');
  await shot(cdp, '06-about-dark', false);

  // 刷新后应保持刚才选择的主题（而不是回到跟随系统）
  await cdp.send('Page.navigate', { url: URL_ });
  await sleep(3500);
  const persisted = await evaluate(cdp, `({
    dark: document.documentElement.classList.contains('dark'),
    stored: localStorage.getItem('leafer-theme')
  })`);
  console.log('  刷新后主题: ' + (persisted.dark ? '深色' : '浅色')
    + '  ' + (persisted.dark === after.dark ? 'OK（持久化生效）' : '*** 失败，主题丢失 ***'));
  await shot(cdp, '07-after-reload', false);

  // 移动端视角
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await sleep(1200);
  const mobile = await evaluate(cdp, `({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    headerVisible: getComputedStyle(document.querySelector('header')).display !== 'none'
  })`);
  console.log('  移动端横向溢出: ' + (mobile.overflow > 1 ? '*** ' + mobile.overflow + 'px ***' : '无'));
  console.log('  移动端顶栏显示: ' + (mobile.headerVisible ? 'OK' : '*** 未显示 ***'));
  await evaluate(cdp, `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);
  await shot(cdp, '08-mobile-about', false);

  // ---- 汇总 ----
  console.log('\n  ── 控制台 ──');
  console.log('  首屏传输量: ' + (bytes / 1024 / 1024).toFixed(2) + ' MB  '
    + JSON.stringify(byType));
  if (jsExceptions.length) {
    console.log('  JS 异常 ' + jsExceptions.length + ' 条:');
    jsExceptions.slice(0, 10).forEach((e) => console.log('     ✗ ' + String(e).split('\n')[0]));
  } else {
    console.log('  JS 异常: 无');
  }
  const realFails = failedRequests.filter((f) => !/googletagmanager|busuanzi|analytics|favicon/i.test(f));
  if (realFails.length) {
    console.log('  请求失败:');
    realFails.slice(0, 15).forEach((f) => console.log('     ✗ ' + f));
  } else {
    console.log('  请求失败（排除第三方统计）: 无');
  }
  const noisy = consoleErrors.filter((c) => !/googletagmanager|busuanzi|analytics/i.test(c));
  console.log('  控制台警告/错误: ' + (noisy.length ? noisy.length + ' 条' : '无'));
  noisy.slice(0, 8).forEach((c) => console.log('     · ' + c.slice(0, 160)));

  console.log('\n  出图目录: ' + OUT + '\n');

  ws.close();
  child.kill();
  await sleep(400);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((err) => {
  console.error('\n  检查失败: ' + err.message);
  child.kill();
  process.exit(1);
});
