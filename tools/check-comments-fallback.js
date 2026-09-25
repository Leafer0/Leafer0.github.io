/**
 * 验证「评论服务不可达时评论区能安静隐藏」。
 *
 *   node tools/check-comments-fallback.js [url]
 *
 * 为什么单独测这个：
 *   这是真实踩过的坑 —— 把评论域名配成了一个国内被墙的地址后，
 *   读者看到的是一个永远转圈或空白的评论框，分不清是"没有评论"
 *   还是"加载失败"。
 *   现在代码里加了探测：连不通就整块隐藏。
 *   但"隐藏"这个行为很容易在后续改动中被破坏（比如忘了改 .value、
 *   或者把判断写成永远为真），所以要有自动化断言守住。
 *
 * 做法：临时把 data.json 的 serverURL 指向一个必然连不通的地址，
 * 检查展开文章后评论区是否消失、页面是否照常可用，测完还原。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');

// 这个地址保证连不通：保留给文档示例的网段，不会有人真的监听
const UNREACHABLE = 'https://comments.invalid';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9351;
const userDataDir = path.join(os.tmpdir(), 'leafer-cfall-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backup = fs.readFileSync(DATA, 'utf8');

function setServerURL(url) {
  const d = JSON.parse(backup);
  d.comments.serverURL = url;
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + '\n', 'utf8');
}

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore' });

(async () => {
  let pass = 0, fail = 0;
  const check = (ok, name, detail) => {
    if (ok) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  };

  try {
    setServerURL(UNREACHABLE);
    console.log('\n  ── 评论服务不可达时的降级行为 ──\n');
    console.log('  临时将 serverURL 设为: ' + UNREACHABLE + '\n');

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
        exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      }
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

    await send('Page.navigate', { url: BASE + '/' });
    await sleep(1500);
    await evaluate(`localStorage.clear(); true`);
    await send('Page.navigate', { url: BASE + '/' });
    await sleep(4500);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); true`);
    await sleep(1500);

    // 进帖子页并展开第一篇文章 —— 这一步会触发评论探测
    await evaluate(`(() => {
      const b=[...document.querySelectorAll('nav[aria-label="主导航"] button')].find(x=>x.textContent.includes('帖子'));
      if(b) b.click(); return !!b;
    })()`);
    await sleep(1200);
    const expanded = await evaluate(`(() => {
      const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('阅读全文'));
      if(!b) return false; b.click(); return true;
    })()`);
    // 轮询等待评论区被移除，而不是赌一个固定 sleep。
    // 探测失败所需时间取决于环境：对不可解析的域名，DNS 失败可能要 7~8 秒
    // （实测），而最初只等 6 秒就断言，于是报出"评论区仍然出现"的假失败。
    // 判据用"是否还在显示加载中"：加载中消失即代表探测已出结果。
    let waited = 0;
    while (waited < 20000) {
      await sleep(1000);
      waited += 1000;
      const stillLoading = await evaluate(`/评论加载中/.test(document.body.innerText)`);
      const hasContainer = await evaluate(
        `document.querySelectorAll('[id^="waline-thread-"], #waline-guestbook').length > 0`
      );
      if (!stillLoading && !hasContainer) break;
    }
    console.log('\n  等待降级完成: ' + (waited / 1000) + ' 秒');

    const state = await evaluate(`(() => {
      // 判定"评论区是否被隐藏"要看**容器本身**，不要用"含『评论』二字的 section"——
      // HTML 注释里也有"评论"二字，用文字匹配会误命中注释所在的节点，
      // 报出"评论区仍然出现"的假失败（真发生过）。
      const containers = [...document.querySelectorAll('[id^="waline-thread-"], #waline-guestbook')];
      return {
        hasCommentSection: containers.length > 0,
        containerIds: containers.map(c => c.id),
        containerText: containers.map(c => (c.innerText || '').slice(0, 60)),
        // 页面上是否有"加载中/加载失败"提示
        loadingHint: /评论加载中/.test(document.body.innerText),
        errorHint: /评论加载失败/.test(document.body.innerText),
        csDebug: window.__cs || null,
        wlCount: document.querySelectorAll('[class^="wl-"]').length,
        bodyText: document.body.innerText.length,
        articleVisible: document.body.innerText.includes('南京城'),
      };
    })()`);

    check(expanded, '文章可展开', expanded ? '' : '未找到"阅读全文"按钮');
    check(!state.hasCommentSection, '评论区已隐藏（不显示坏掉的框子）',
      state.hasCommentSection
        ? '仍存在的容器: ' + JSON.stringify(state.containerIds)
          + '  __cs=' + JSON.stringify(state.csDebug)
          + '  可见元素数=' + state.wlCount
        : '整块消失，符合预期');
    check(state.wlCount === 0, '没有残留的 Waline 元素', state.wlCount + ' 个 wl- 元素');
    check(state.articleVisible, '文章正文照常显示', '页面文字 ' + state.bodyText + ' 字符');
    check(exceptions.length === 0, '无未捕获 JS 异常',
      exceptions.length ? exceptions[0].split('\n')[0] : '无');

    ws.close();
  } finally {
    // 无论成功失败都要还原，避免把测试用的假地址留在仓库里
    fs.writeFileSync(DATA, backup, 'utf8');
    console.log('\n  已还原 data.json');
    child.kill();
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  console.log(`\n  ── 结果: ${pass} 通过, ${fail} 失败 ──\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  try { fs.writeFileSync(DATA, backup, 'utf8'); } catch {}
  console.error('检查失败: ' + e.message);
  child.kill();
  process.exit(1);
});
