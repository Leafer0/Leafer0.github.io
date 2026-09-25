/**
 * 验证评论的"提交"链路（发出的是真实数据，测完会说明如何清理）。
 *
 *   node tools/test-comment-submit.js [Waline地址]
 *
 * 为什么单独测 POST：
 *   前述检查都只验证了"读"（GET /api/comment 取评论列表）。
 *   而"不能评论"是**写**的问题 —— 两者走不同方法、不同响应头，
 *   读得通不代表写得进去（例如某些拦截只针对 POST）。
 *
 * 注意：这会真的创建一条评论。默认用带标记的内容，
 * 方便你在 Waline 后台一眼找到并删除。
 */
const BASE = (process.argv[2] || 'https://waline.leafersgarden.xyz').replace(/\/$/, '');
const TEST_PATH = '/guestbook';

async function main() {
  console.log('\n  ── 评论提交链路测试 ──');
  console.log('  服务: ' + BASE);
  console.log('  path: ' + TEST_PATH + '\n');

  // 1. 带 Origin 的预检（浏览器提交前会发）
  console.log('  1) CORS 预检 (OPTIONS)');
  try {
    const pre = await fetch(BASE + '/api/comment', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://leafersgarden.xyz',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    console.log('     HTTP ' + pre.status
      + '  allow-origin=' + (pre.headers.get('access-control-allow-origin') || '-')
      + '  allow-methods=' + (pre.headers.get('access-control-allow-methods') || '-'));
  } catch (e) {
    console.log('     失败: ' + e.message);
  }

  // 2. 实际提交
  const marker = '自动测试-' + new Date().toISOString().slice(0, 19);
  console.log('\n  2) 提交一条评论 (POST)');
  let submitted = null;
  try {
    const res = await fetch(BASE + '/api/comment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://leafersgarden.xyz',
      },
      body: JSON.stringify({
        comment: marker + '（可删除）',
        nick: '链路自检',
        mail: '',
        link: '',
        ua: 'dsh-check',
        url: TEST_PATH,
      }),
    });
    const text = await res.text();
    console.log('     HTTP ' + res.status);
    console.log('     响应: ' + text.slice(0, 220));
    try { submitted = JSON.parse(text); } catch {}
  } catch (e) {
    console.log('     提交失败: ' + e.message);
  }

  // 3. 读回来确认
  console.log('\n  3) 重新读取，确认刚才那条是否已存在');
  try {
    const res = await fetch(BASE + '/api/comment?path=' + encodeURIComponent(TEST_PATH)
      + '&pageSize=50&sortBy=insertedAt_desc');
    const j = await res.json();
    const found = (j.data && j.data.data || []).find((c) => String(c.comment || '').includes(marker));
    if (found) {
      console.log('     ✅ 已写入并读回，评论条数 = ' + j.data.count);
      console.log('     清理方式：登录 ' + BASE + '/ui 找到内容含「' + marker + '」的评论删除');
    } else {
      console.log('     ⚠ 未读回。可能服务端开启了评论审核（COMMENT_AUDIT），');
      console.log('       新评论需在 ' + BASE + '/ui 后台审核后才显示。');
      console.log('       当前读到的评论条数 = ' + (j.data ? j.data.count : '?'));
    }
  } catch (e) {
    console.log('     读取失败: ' + e.message);
  }
  console.log('');
}

main().catch((e) => { console.error(e); process.exit(1); });
