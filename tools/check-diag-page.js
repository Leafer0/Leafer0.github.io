/**
 * 验证诊断页 /diag/ 能正常工作。
 *
 *   node tools/check-diag-page.js [本地站点URL]
 *
 * 为什么需要验证：这个页面是要发给**别人**用的，
 * 如果它自己有 bug（比如按钮没绑定、fetch 抛错未捕获），
 * 对方只会看到空白或没反应 —— 那就白费了一次沟通。
 * 所以先在本地跑一遍：点按钮、等结果、确认表格与原始数据都出来了。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = (process.argv[2] || 'http://127.0.0.1:8899').replace(/\/$/, '');

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browserPath = BROWSERS.find((p) => fs.existsSync(p));
const PORT = 9385;
const userDataDir = path.join(os.tmpdir(), 'leafer-diagpage-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=900,1000', 'about:blank',
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

  console.log('\n  ── 诊断页自检 ──\n');

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: SITE + '/diag/' });
  await sleep(2500);

  const loaded = await evaluate(`(() => ({
    title: document.title,
    hasButton: !!document.getElementById('run'),
    btnText: (document.getElementById('run') || {}).textContent || ''
  }))()`);
  check(loaded.hasButton, '页面加载且有「开始检测」按钮', '标题=' + loaded.title);
  check(/开始检测/.test(loaded.btnText), '按钮初始文案正确', loaded.btnText);

  // 点按钮
  await evaluate(`document.getElementById('run').click(); true`);

  // 等结果出现（各项含超时，最长约 45 秒）
  let rows = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    rows = await evaluate(`document.querySelectorAll('#table tr').length`);
    const done = await evaluate(`!document.getElementById('run').disabled`);
    if (done && rows >= 3) break;
  }

  const out = await evaluate(`(() => {
    const tb = document.getElementById('table');
    const raw = document.getElementById('raw');
    const btn = document.getElementById('run');
    return {
      rows: [...tb.querySelectorAll('tr')].map(tr => tr.innerText.replace(/\\t+/g, ' | ').slice(0, 80)),
      hasRaw: raw.textContent.length > 20,
      rawHead: raw.textContent.slice(0, 120),
      btnDisabled: btn.disabled,
      btnText: btn.textContent,
      resultVisible: getComputedStyle(document.getElementById('resultCard')).display !== 'none'
    };
  })()`);

  check(out.resultVisible, '结果区域已显示');
  console.log('\n  检测项:');
  out.rows.forEach((r) => console.log('    ' + r));
  console.log('');
  check(out.rows.length >= 3, '至少产出了 3 项结果', out.rows.length + ' 项');
  check(out.hasRaw, '原始数据已生成', out.rawHead.slice(0, 60) + '...');
  check(!out.btnDisabled && /重新检测/.test(out.btnText), '按钮恢复为可再次点击', out.btnText);
  check(exceptions.length === 0, '无未捕获 JS 异常',
    exceptions.length ? exceptions[0] : '无');

  console.log(`\n  ── 结果: ${pass} 通过, ${fail} 失败 ──\n`);

  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('检查失败: ' + e.message); child.kill(); process.exit(1); });
