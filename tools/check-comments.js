/**
 * 检查 Waline 评论区是否真的接对了。
 *
 *   node tools/check-comments.js [url]
 *
 * 这个脚本刻意分两种情形验证，因为结论完全不同：
 *
 *   A. data.json 里没填 serverURL
 *      -> 期望整站不出现评论区（而不是露出半个空白框子或报错）
 *
 *   B. 已填 serverURL
 *      -> 期望展开文章后 Waline 真的渲染出评论界面、能连上服务端
 *
 * 之所以要真连服务端，是因为「配置写错」和「服务没起来」这两种失败
 * 在页面上看起来一模一样（都是空白），只看 DOM 判断不出来。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const serverURL = (data.comments && data.comments.serverURL) || '';
const configured = !!serverURL;

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9343;
const userDataDir = path.join(os.tmpdir(), 'leafer-comments-' + Date.now());
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
  const failedRequests = [];
  const apiResponses = [];
  const allRequests = new Map(); // requestId -> url，用来把失败请求还原成可读信息
  let pageReady = false;

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Network.requestWillBeSent') {
      allRequests.set(m.params.requestId, m.params.request.url);
    }
    if (m.method === 'Network.loadingFailed') {
      const url = allRequests.get(m.params.requestId) || '(未知)';
      failedRequests.push(`${m.params.errorText}  ${url.slice(0, 120)}`);
    }
    if (m.method === 'Network.responseReceived') {
      const url = m.params.response.url;
      // 只关心打到 Waline 服务端的请求
      if (serverURL && url.startsWith(serverURL)) {
        apiResponses.push({ status: m.params.response.status, url: url.replace(serverURL, '') });
      }
    }
    if (m.method === 'Page.loadEventFired') pageReady = true;
  });

  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    // 每个 CDP 调用都要有超时，否则页面里某个请求挂住会把整个脚本拖死
    setTimeout(() => {
      if (pending.has(i)) { pending.delete(i); rej(new Error('CDP 超时: ' + method)); }
    }, 30000);
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  let pass = 0, fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  };

  console.log('\n  ── Waline 评论区检查 ──\n');
  console.log('  serverURL: ' + (configured ? serverURL : '(未配置)'));
  console.log('  模式: ' + (configured ? 'B. 已配置，期望渲染评论' : 'A. 未配置，期望整站隐藏评论区') + '\n');

  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1500);
  // 必须清掉主题记录：否则上一轮跑测试时写入的 leafer-theme 会让页面直接以深色启动，
  // "浅色 -> 深色"的对比就失去意义（曾经因此误判成"暗色不生效"）。
  await evaluate(`localStorage.clear(); true`);
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4500);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
  await sleep(1500);

  // 切到帖子页
  await evaluate(`(() => {
    const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
    if(b) b.click(); return !!b;
  })()`);
  await sleep(1200);

  // 展开第一篇文章
  const expanded = await evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));
    if(!b) return false; b.click(); return true;
  })()`);
  await sleep(configured ? 6000 : 1500); // 已配置时给 Waline 留出请求和渲染时间

  const dom = await evaluate(`(() => {
    const sec = [...document.querySelectorAll('section')].find(s => /评论/.test(s.textContent));
    const wl = document.querySelector('.wl-panel, .wl-comment, [class^="wl-"]');
    return {
      sectionExists: !!sec,
      sectionText: sec ? sec.innerText.trim().slice(0, 200) : '',
      walineRendered: !!wl,
      wlClassCount: document.querySelectorAll('[class^="wl-"]').length,
      walineGlobal: typeof window.Waline !== 'undefined',
      walineVersion: (window.Waline && window.Waline.version) || null
    };
  })()`);

  if (!configured) {
    check('文章可展开', expanded, expanded ? '' : '没找到"阅读全文"按钮');
    check('未配置时不渲染评论区', !dom.sectionExists,
      dom.sectionExists ? '评论区仍然出现了（应为隐藏）' : '整站无评论区，符合预期');
    check('Waline 脚本未产生副作用', dom.wlClassCount === 0,
      dom.wlClassCount + ' 个 wl- 元素');
  } else {
    check('文章可展开', expanded, expanded ? '' : '没找到"阅读全文"按钮');
    check('评论区已渲染', dom.sectionExists, dom.sectionExists ? '' : '页面上没找到评论区');
    check('Waline 全局对象可用', dom.walineGlobal, 'version=' + dom.walineVersion);
    check('Waline 界面已挂载', dom.walineRendered,
      dom.walineRendered ? dom.wlClassCount + ' 个 wl- 元素' : '没有渲染出任何 wl- 元素');

    const ok = apiResponses.filter((r) => r.status >= 200 && r.status < 400);
    const bad = apiResponses.filter((r) => r.status >= 400);
    check('已成功连上 Waline 服务端', ok.length > 0,
      ok.length ? ok.length + ' 个成功请求，例如 ' + ok[0].url : '没有任何请求到达 ' + serverURL);
    check('服务端无错误响应', bad.length === 0,
      bad.length ? bad.map((b) => b.status + ' ' + b.url).slice(0, 3).join('; ') : '无 4xx/5xx');

    // 评论按文章隔离：path 里应该带上文章序号
    const pathReqs = apiResponses.filter((r) => /path=/.test(r.url));
    check('评论按文章区分（path 带序号）', pathReqs.some((r) => /thoughts%2F0|\/thoughts\/0/.test(r.url)),
      pathReqs.length ? decodeURIComponent(pathReqs[0].url).slice(0, 70) : '没有带 path 的请求');

    // 收起文章后应销毁实例，避免内存泄漏和残留 DOM
    await evaluate(`(() => {
      const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('收起全文'));
      if(b) b.click(); return !!b;
    })()`);
    await sleep(1500);
    const afterCollapse = await evaluate(`(() => {
      const sec=[...document.querySelectorAll('section')].find(s=>/评论/.test(s.textContent));
      return { section: !!sec, wl: document.querySelectorAll('[class^="wl-"]').length };
    })()`);
    check('收起文章后评论区被移除', !afterCollapse.section && afterCollapse.wl === 0,
      'section=' + afterCollapse.section + ' wl元素=' + afterCollapse.wl);

    // 展开另一篇文章：应加载该文章自己的评论，而不是复用上一篇的
    await evaluate(`(() => {
      const btns=[...document.querySelectorAll('button')].filter(x=>x.textContent.includes('阅读全文'));
      if(btns[1]) btns[1].click(); return btns.length;
    })()`);
    await sleep(5000);
    const second = await evaluate(`(() => {
      const el=document.querySelector('[id^="waline-thread-"]');
      return { id: el ? el.id : null, wl: document.querySelectorAll('[class^="wl-"]').length };
    })()`);
    const secondPathReq = apiResponses.filter((r) => /thoughts%2F1|\/thoughts\/1/.test(r.url));
    check('切换文章后评论区正常', second.wl > 0 && /waline-thread-1/.test(second.id || ''),
      '容器 id=' + second.id + ' wl元素=' + second.wl);
    check('第二篇文章加载的是它自己的评论', secondPathReq.length > 0,
      secondPathReq.length ? decodeURIComponent(secondPathReq[0].url).slice(0, 70) : '未发出针对第二篇的请求');

    // 暗色模式：Waline 的 dark 配的是 CSS 选择器 'html.dark'，
    // 验证方向是「html 上的 dark 类变化时，Waline 的配色是否跟着变」。
    //
    // 两个坑，之前都踩过：
    //   1. 采样元素必须确实存在。.wl-card 在本站结构里为 null，
    //      拿 null 和 null 比较会得出"配色没变"的错误结论。
    //   2. 要取真正会变的属性。.wl-panel 背景是透明的，恒为 rgba(0,0,0,0)，
    //      用它会误判。这里只比较文字色与边框色。
    const probe = `(() => {
      const el = document.querySelector('.wl-editor, .wl-input, [class*="wl-editor"]');
      const header = document.querySelector('.wl-header');
      const bg = document.body;
      return {
        dark: document.documentElement.classList.contains('dark'),
        editorColor: el ? getComputedStyle(el).color : null,
        editorBorder: el ? getComputedStyle(el).borderTopColor : null,
        headerColor: header ? getComputedStyle(header).color : null,
        bodyBg: getComputedStyle(bg).backgroundColor
      };
    })()`;

    const lightState = await evaluate(probe);
    // 起始必须是浅色，否则下面的对比没有意义。若不是，先纠正再说明。
    if (lightState.dark) {
      await evaluate(`document.documentElement.classList.remove('dark'); true`);
      await sleep(1200);
    }
    const baseState = await evaluate(probe);
    await evaluate(`document.documentElement.classList.add('dark'); true`);
    await sleep(1500);
    const darkState = await evaluate(probe);
    await evaluate(`document.documentElement.classList.remove('dark'); true`);
    await sleep(500);

    check('暗色模式下 Waline 配色跟随变化',
      baseState.dark === false && baseState.editorColor !== darkState.editorColor,
      '起始 dark=' + baseState.dark
      + '，编辑器文字色 ' + baseState.editorColor + ' -> ' + darkState.editorColor
      + '，页面背景 ' + baseState.bodyBg + ' -> ' + darkState.bodyBg);

    console.log('\n  ── 服务端请求明细 ──');
    if (!apiResponses.length) console.log('    (无)');
    apiResponses.slice(0, 8).forEach((r) => console.log('    ' + r.status + '  ' + r.url));
  }

  console.log('  ── 结果: ' + pass + ' 通过, ' + fail + ' 失败 ──');
  if (failedRequests.length) {
    console.log('\n  ── 加载失败的请求 ──');
    failedRequests.slice(0, 10).forEach((f) => console.log('    ✗ ' + f));
  }
  console.log('');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
