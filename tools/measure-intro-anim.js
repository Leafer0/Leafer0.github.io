/**
 * 测量入场动画里各元素在时间轴上的实际变化。
 *
 *   node tools/measure-intro-anim.js [站点URL]
 *
 * 为什么需要它：截图对比"看起来一样"可能是
 *   1. 动画根本没跑（被 reduced-motion 压掉了）
 *   2. 动画跑了，但变化太细微，截图上看不出来
 * 这两者的修法完全不同。这里直接读计算样式与描边长度的数值变化，
 * 用数据判断动画到底有没有在推进。
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
const PORT = 9381;
const userDataDir = path.join(os.tmpdir(), 'leafer-anim-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
  '--window-size=1440,900', 'about:blank',
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
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      return { __err: String((d.exception && d.exception.description) || d.text).split('\n')[0] };
    }
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  // 覆盖系统偏好：不减少动态效果
  await send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  });

  await send('Page.navigate', { url: SITE + '/' });
  await sleep(1000);
  await evaluate(`localStorage.clear(); true`);

  // 重新加载并立刻开始采样，不等渲染完成 —— 否则会错过动画开头
  await send('Page.navigate', { url: SITE + '/' });

  console.log('\n  ── 偏好确认 ──');
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    const pref = await evaluate(`({
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      rendered: (() => { const t = document.querySelector('.shimmer-text'); return !!t && t.textContent.indexOf('{{') === -1; })()
    })`);
    if (pref && pref.rendered) {
      console.log('  prefers-reduced-motion: reduce = ' + pref.reduce
        + (pref.reduce ? '   ⚠ 动画会被压掉，测不出过程' : '   OK，动画应能正常播放'));
      break;
    }
  }

  console.log('\n  ── 元素随时间的变化 ──\n');
  console.log('   时刻 | 角饰opacity | 描边dashoffset | 叶片opacity | 细线宽度 | 标题opacity');
  for (const ms of [50, 250, 500, 800, 1100, 1500, 2000]) {
    await sleep(ms === 50 ? 50 : 0);
    const st = await evaluate(`(() => {
      const bot = document.querySelector('.intro-botanical');
      const stroke = document.querySelector('.intro-botanical .bot-stroke');
      const fill = document.querySelector('.intro-botanical .bot-fill');
      const rule = document.querySelector('.intro-rule');
      const title = document.querySelector('.shimmer-text');
      const veil = document.querySelector('.intro-veil');
      return {
        botOpacity: bot ? getComputedStyle(bot).opacity : '-',
        dash: stroke ? getComputedStyle(stroke).strokeDashoffset : '-',
        fillOpacity: fill ? getComputedStyle(fill).opacity : '-',
        ruleW: rule ? Math.round(rule.getBoundingClientRect().width) : -1,
        titleOpacity: veil ? getComputedStyle(veil).opacity : '-'
      };
    })()`);
    if (st && st.__err) { console.log('  ' + ms + 'ms 求值失败: ' + st.__err); continue; }
    console.log(`  ${String(ms).padStart(4)}ms | ${String(st.botOpacity).padEnd(11)} | `
      + `${String(st.dash).padEnd(14)} | ${String(st.fillOpacity).padEnd(11)} | `
      + `${String(st.ruleW).padStart(8)} | ${st.titleOpacity}`);
    if (ms < 2000) await sleep(ms === 50 ? 200 : 250);
  }

  console.log('');
  ws.close(); child.kill();
  await sleep(300);
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  process.exit(0);
})().catch((e) => { console.error('失败: ' + e.message); child.kill(); process.exit(1); });
