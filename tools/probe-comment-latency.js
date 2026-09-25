/**
 * 连续采样评论服务的响应耗时，观察抖动情况。
 *
 *   node tools/probe-comment-latency.js [Waline地址] [次数]
 *
 * 为什么需要它：
 *   评论"时好时坏"是典型的间歇性问题，靠单次测试判断不了 ——
 *   测到一次正常会误以为修好了，测到一次失败又会误以为很严重。
 *   这里连续采样若干次，用分布（最快/中位/最慢/失败次数）来判断：
 *     - 若普遍很快、偶尔超时  -> 属网络抖动，靠重试即可
 *     - 若整体都慢           -> 该放宽超时或换托管
 *     - 若频繁失败           -> 链路确实不可靠，需要迁移
 *
 * 走 Node 的 https 模块（本机对 Vercel 的链路此前不稳，
 * 所以同时报告失败率，便于判断结论是否可信）。
 */
const https = require('https');

const BASE = (process.argv[2] || 'https://waline.leafersgarden.xyz').replace(/\/$/, '');
const COUNT = Number(process.argv[3]) || 12;
const PATHQ = '/api/comment?path=/guestbook&pageSize=1';

function once() {
  return new Promise((resolve) => {
    const url = new URL(BASE + PATHQ + '&cb=' + Math.random());
    const t0 = Date.now();
    const req = https.get(url, {
      headers: { 'User-Agent': 'dsh-probe', Origin: 'https://leafersgarden.xyz' },
      timeout: 20000,
    }, (res) => {
      let len = 0;
      res.on('data', (c) => (len += c.length));
      res.on('end', () => resolve({
        ok: res.statusCode === 200,
        status: res.statusCode,
        ms: Date.now() - t0,
        bytes: len,
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: '超时(20s)', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ ok: false, err: e.code || e.message, ms: Date.now() - t0 }));
  });
}

(async () => {
  console.log('\n  ── 评论服务响应耗时采样 ──');
  console.log('  地址: ' + BASE);
  console.log('  次数: ' + COUNT + '（连续，不间隔）\n');

  const rows = [];
  for (let i = 1; i <= COUNT; i++) {
    const r = await once();
    rows.push(r);
    const label = r.ok ? 'HTTP ' + r.status : (r.err || '失败');
    console.log(`  #${String(i).padStart(2)}  ${String(r.ms).padStart(6)}ms  ${label}`);
  }

  const okRows = rows.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const failCount = rows.length - okRows.length;

  console.log('\n  ── 统计 ──');
  console.log('  成功 ' + okRows.length + ' / ' + rows.length + '   失败 ' + failCount);
  if (okRows.length) {
    const min = okRows[0];
    const max = okRows[okRows.length - 1];
    const median = okRows[Math.floor(okRows.length / 2)];
    const avg = Math.round(okRows.reduce((a, b) => a + b, 0) / okRows.length);
    console.log('  最快 ' + min + 'ms   中位 ' + median + 'ms   平均 ' + avg + 'ms   最慢 ' + max + 'ms');
    console.log('  最慢/中位 = ' + (max / Math.max(median, 1)).toFixed(1) + ' 倍'
      + (max / Math.max(median, 1) > 4 ? '   ← 抖动明显' : '   ← 较稳定'));
  }

  console.log('\n  ── 判断 ──');
  if (failCount === 0 && okRows.length && okRows[okRows.length - 1] < 3000) {
    console.log('  服务稳定，未观察到抖动。');
    console.log('  → 若访客仍偶发失败，问题在访客到服务端的那段链路（如运营商出口）。');
  } else if (failCount === 0) {
    console.log('  有慢请求但都成功。');
    console.log('  → 属 serverless 冷启动或链路拥塞，放宽客户端超时或加重试即可。');
  } else if (failCount < rows.length / 3) {
    console.log('  偶发失败（' + failCount + '/' + rows.length + '）。');
    console.log('  → 典型网络抖动。客户端重试是第一道防线，值得把重试做得更顺手。');
  } else {
    console.log('  失败频繁（' + failCount + '/' + rows.length + '）。');
    console.log('  → 链路确实不可靠，考虑把评论服务迁到更稳的托管。');
    console.log('     注意：本机对 Vercel 的链路本身不稳，建议同时用访客设备验证。');
  }
  console.log('');

  process.exit(0);
})().catch((e) => { console.error('采样失败: ' + e.message); process.exit(1); });
