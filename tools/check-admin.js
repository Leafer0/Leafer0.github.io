/**
 * 检查 /admin 后台能否正常加载。
 *
 *   node tools/check-admin.js [url]
 *
 * Sveltia CMS 会在浏览器里解析 admin/config.yml。
 * config.yml 写错了（widget 名不对、types 结构不对、缩进错误），
 * 很典型的后果是后台直接白屏或卡在加载动画上 —— 而且没有明显报错。
 * 所以这里用无头浏览器实际打开一次，把控制台错误和加载状态都抓出来。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = (process.argv[2] || 'http://127.0.0.1:8899/').replace(/\/$/, '');
const URL_ = BASE + '/admin/';

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9341;
const userDataDir = path.join(os.tmpdir(), 'leafer-admin-' + Date.now());
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
  const consoleMsgs = [];
  const exceptions = [];
  const failed = [];

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map((a) => a.value || a.description || '').join(' ');
      if (text) consoleMsgs.push(`[${m.params.type}] ${text}`);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push(d.exception?.description || d.text);
    }
    if (m.method === 'Network.loadingFailed') {
      failed.push(`${m.params.type} ${m.params.errorText}`);
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
  await send('Network.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(9000); // 等 CDN 取回 sveltia-cms.js 并解析 config

  const state = await evaluate(`(() => {
    const text = (document.body.innerText || '').trim();
    // 判定"是否已完成加载"不能看我们自己写的 #loading 占位元素 ——
    // Sveltia 是直接替换 body 内容的，不会去移除那个占位节点。
    // 正确做法是看 CMS 自己的界面有没有渲染出来。
    const mounted = !!document.querySelector('sveltia-cms, [class*="sveltia"]')
      || /Sveltia CMS|登录|Sign In|集合|Collections/.test(text);
    return {
      title: document.title,
      bodyLength: text.length,
      mounted,
      hasLoginUi: /登录|Sign In|访问令牌|access token/i.test(text),
      // 加载失败提示是我们自己写的那段
      showsLoadError: text.includes('后台脚本加载失败'),
      snippet: text.slice(0, 400)
    };
  })()`);

  let pass = 0, fail = 0;
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  };

  console.log('\n  ── /admin 后台加载检查 ──\n');
  console.log('  页面标题: ' + state.title);
  check('CMS 脚本从 CDN 加载成功', !state.showsLoadError,
    state.showsLoadError ? '未取到 sveltia-cms.js（网络或 CDN 问题）' : '已加载');
  check('CMS 界面已渲染', state.mounted,
    state.mounted ? (state.hasLoginUi ? '已进入登录界面（配置解析通过）' : '已渲染') : '仍停在加载动画，可能是 config.yml 解析失败');
  check('页面有实际内容', state.bodyLength > 20, state.bodyLength + ' 字符');
  check('无未捕获 JS 异常', exceptions.length === 0,
    exceptions.length ? exceptions[0].split('\n')[0] : '无');

  // 配置解析错误通常会以 console.error 的形式出现
  const cfgErrors = consoleMsgs.filter((m) =>
    /config|yaml|widget|collection|invalid|error/i.test(m) && /error|invalid|fail/i.test(m)
  );
  check('未发现配置解析错误', cfgErrors.length === 0,
    cfgErrors.length ? cfgErrors[0].slice(0, 200) : '无');

  console.log('\n  ── 页面首屏文字（用于人工判断是否已进入登录界面）──');
  console.log('  ' + state.snippet.replace(/\n+/g, ' | ').slice(0, 300));

  if (consoleMsgs.length) {
    console.log('\n  ── 控制台信息（前 10 条）──');
    consoleMsgs.slice(0, 10).forEach((m) => console.log('    ' + m.slice(0, 180)));
  }
  if (exceptions.length) {
    console.log('\n  ── JS 异常 ──');
    exceptions.slice(0, 5).forEach((e) => console.log('    ' + String(e).split('\n')[0]));
  }
  if (failed.length) {
    console.log('\n  ── 请求失败 ──');
    failed.slice(0, 8).forEach((f) => console.log('    ' + f));
  }

  console.log('\n  ── 结果: ' + pass + ' 通过, ' + fail + ' 失败 ──\n');

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
