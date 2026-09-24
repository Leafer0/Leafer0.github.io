/**
 * 只验证主题逻辑：跟随系统 -> 手动选择 -> 落盘 -> 刷新保持。
 *
 *   node tools/check-theme.js [url]
 *
 * 会分别模拟"系统深色"和"系统浅色"两种环境各跑一遍，
 * 因为这两条分支的行为不一样，只测一种很容易漏。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8899/';
const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9336;
const userDataDir = path.join(os.tmpdir(), 'leafer-theme-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1280,800', 'about:blank',
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const readState = () => evaluate(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>/模式/.test(x.textContent));
    return {
      dark: document.documentElement.classList.contains('dark'),
      label: b ? b.textContent.trim() : '(没找到按钮)',
      stored: localStorage.getItem('leafer-theme'),
      explicit: !!window.__hasExplicitTheme,
      themeColor: (document.querySelector('meta[name="theme-color"]')||{}).content
    };
  })()`);

  const clickToggle = () => evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/模式/.test(x.textContent));
      if(!b) return false; b.click(); return true;})()`);

  let pass = 0; let fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log('  OK    ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  失败  ' + name + '   ' + detail); }
  }

  for (const scheme of ['dark', 'light']) {
    console.log('\n  ===== 模拟系统偏好: ' + (scheme === 'dark' ? '深色' : '浅色') + ' =====');
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });

    // 1) 首次访问：应跟随系统
    await send('Page.navigate', { url: URL_ });
    await sleep(1200);
    await evaluate(`localStorage.clear(); true`);
    await send('Page.navigate', { url: URL_ });
    await sleep(3800);

    const s0 = await readState();
    check('首次访问跟随系统',
      s0.dark === (scheme === 'dark'),
      `dark=${s0.dark} stored=${s0.stored} theme-color=${s0.themeColor}`);
    check('按钮文案指向"将要切换到的模式"',
      s0.label === (s0.dark ? '浅色模式' : '深色模式'),
      `文案="${s0.label}"`);

    // 2) 点击一次：应翻转 + 落盘
    await clickToggle();
    await sleep(700);
    const s1 = await readState();
    check('点击后主题翻转', s1.dark !== s0.dark, `${s0.dark} -> ${s1.dark}`);
    check('选择已写入 localStorage',
      s1.stored === (s1.dark ? 'dark' : 'light'),
      `stored=${s1.stored}`);
    check('theme-color 同步更新',
      s1.themeColor === (s1.dark ? '#0b0f14' : '#FDFBF7'),
      `theme-color=${s1.themeColor}`);

    // 3) 再刷新：应保持用户选择，而不是退回跟系统
    await send('Page.navigate', { url: URL_ });
    await sleep(3000);
    const s2 = await readState();
    check('刷新后保持用户选择', s2.dark === s1.dark, `刷新后 dark=${s2.dark}`);

    // 4) 系统偏好反向变化时，用户已显式选择过，不应被覆盖
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme === 'dark' ? 'light' : 'dark' }],
    });
    await sleep(900);
    const s3 = await readState();
    check('已手动选择后，系统偏好不再覆盖',
      s3.dark === s2.dark, `系统改为 ${scheme === 'dark' ? '浅色' : '深色'} 后 dark=${s3.dark}`);
  }

  console.log('\n  ===== 结果: ' + pass + ' 通过, ' + fail + ' 失败 =====\n');
  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
