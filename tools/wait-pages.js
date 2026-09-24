/**
 * 等待 GitHub Pages 完成部署。
 *
 *   node tools/wait-pages.js [超时秒数]
 *
 * 为什么需要它：push 之后 Pages 需要几十秒到几分钟才构建完，
 * 这期间线上还是旧版，很容易误以为"发布失败"。
 * 这里同时比对两个信号：
 *   1. GitHub 的 deployment 记录是否出现本次 commit
 *   2. 线上 index.html 是否已变成新版本（用新版特征字符串判定）
 */
const REPO = 'Leafer0/Leafer0.github.io';
const SITE = 'https://leafer0.github.io/';
const TIMEOUT = Number(process.argv[2]) || 300;

// 新版特征：旧版一定没有这些字符串
const MARKERS = [
  { key: 'style.css', desc: '本地预编译样式' },
  { key: 'icons.js', desc: '内联 SVG 图标' },
  { key: 'site-theme.js', desc: '主题配置外置' },
];

const headers = { 'User-Agent': 'dsh-check', Accept: 'application/vnd.github+json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getLatestDeployment() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/deployments?per_page=1`, { headers });
    const d = await r.json();
    return Array.isArray(d) && d.length ? d[0] : null;
  } catch {
    return null;
  }
}

async function fetchLive() {
  try {
    const r = await fetch(SITE + '?cb=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    const html = await r.text();
    return html;
  } catch (e) {
    return null;
  }
}

(async () => {
  const head = (await (await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=1`, { headers })).json())[0];
  const targetSha = head.sha.slice(0, 7);
  console.log(`\n  目标提交: ${targetSha}  ${head.commit.message.split('\n')[0]}`);
  console.log(`  等待 Pages 部署（最多 ${TIMEOUT} 秒）...\n`);

  const start = Date.now();
  let lastNote = '';

  while ((Date.now() - start) / 1000 < TIMEOUT) {
    const elapsed = Math.round((Date.now() - start) / 1000);

    const dep = await getLatestDeployment();
    const depSha = dep ? dep.sha.slice(0, 7) : '(无记录)';

    const html = await fetchLive();
    const markersOk = html ? MARKERS.every((m) => html.includes(m.key)) : false;
    const title = html ? (/<title>(.*?)<\/title>/.exec(html) || [])[1] : null;

    const note = `  [${String(elapsed).padStart(3)}s] deployment=${depSha}  线上标记=${markersOk ? '新版' : '旧版'}  标题=${title}`;
    if (note !== lastNote) {
      console.log(note);
      lastNote = note;
    }

    // 判定成功：deployment 指向本次提交，且线上已是新版
    if (depSha === targetSha && markersOk) {
      console.log('\n  部署完成，线上已是新版本。\n');
      console.log('  抽查线上资源可访问性:');
      for (const p of ['style.css', 'icons.js', 'site-theme.js', 'img/bg3.png.webp', 'img/Leafer.jpg.webp']) {
        try {
          const r = await fetch(SITE + p, { method: 'GET', headers: { Range: 'bytes=0-0' } });
          console.log(`     ${r.status}  ${p}`);
        } catch (e) {
          console.log(`     失败  ${p}  ${e.message}`);
        }
      }
      console.log('');
      process.exit(0);
    }

    await sleep(10000);
  }

  console.log(`\n  超时：${TIMEOUT} 秒内未观察到部署完成。`);
  console.log('  可以稍等后重跑：node tools/wait-pages.js');
  console.log(`  也可在浏览器查看: https://github.com/${REPO}/deployments\n`);
  process.exit(1);
})();
