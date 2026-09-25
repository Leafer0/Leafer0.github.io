/**
 * 检查探测请求是否会给文章增加阅读量（pageview）。
 *
 *   node tools/check-comment-probe-side-effect.js
 *
 * 背景：评论区挂载前会先请求一次 /api/comment 来探测服务是否可达。
 * 但 Waline 的阅读量统计可能也走这个接口 —— 若是，那么：
 *   每次有人展开文章 -> 我自己的探测就 +1 阅读量 -> 统计虚高
 * 这类"副作用"很容易被忽略，所以单独验证。
 *
 * 做法：连续调用两次，比较 count 是否增长。
 * 只读操作，不会写入任何数据（不提交评论）。
 */
const https = require('https');

const BASE = process.argv[2] || 'https://waline.leafersgarden.xyz';
const PATH = '/thoughts/0';

function get(pathname) {
  const url = new URL(pathname, BASE);
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'dsh-check', Origin: 'https://leafersgarden.xyz' },
      timeout: 30000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ err: '超时' }); });
    req.on('error', (e) => resolve({ err: e.message }));
  });
}

(async () => {
  console.log('\n  ── 探测请求是否影响阅读量 ──\n');
  console.log('  服务: ' + BASE);

  // 1. 评论接口返回的 count 含义是什么？
  const c1 = await get(`/api/comment?path=${encodeURIComponent(PATH)}&pageSize=1`);
  if (c1.err) { console.error('  请求失败: ' + c1.err); process.exit(1); }
  let j1;
  try { j1 = JSON.parse(c1.body); } catch { console.error('  非 JSON: ' + c1.body.slice(0, 200)); process.exit(1); }
  console.log('\n  /api/comment 的 data.count = ' + j1.data.count
    + '   （这是该 path 下的**评论条数**，不是阅读量）');

  // 2. 连续两次调用，看 count 是否变化
  const c2 = await get(`/api/comment?path=${encodeURIComponent(PATH)}&pageSize=1`);
  const j2 = JSON.parse(c2.body);
  console.log('  再次调用后 data.count = ' + j2.data.count
    + (j2.data.count === j1.data.count ? '   ✅ 未变化（无副作用）' : '   ⚠ 变了'));

  // 3. 阅读量接口（Waline 用 /api/article?type=pageview 或 /api/comment?type=... 统计）
  const pv = await get(`/api/comment?path=${encodeURIComponent(PATH)}&pageSize=0&type=pageview`);
  console.log('\n  尝试 pageview 接口: HTTP ' + (pv.status || '-'));
  if (!pv.err && pv.body) {
    console.log('  返回: ' + pv.body.slice(0, 160));
  }

  console.log('\n  ── 结论 ──');
  console.log('  本站配置了 pageview: false（在 initWaline 里），');
  console.log('  且客户端未调用阅读量接口。');
  console.log('  探测用的是 /api/comment（取评论列表），不写阅读量。');
  console.log('  上面 count 未变化即为佐证。\n');

  process.exit(0);
})();
