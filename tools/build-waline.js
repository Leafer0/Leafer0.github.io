/**
 * 把 Waline 客户端下载到 vendor/waline/，供页面本地引用。
 *
 *   node tools/build-waline.js
 *
 * 为什么不直接用 unpkg CDN：
 *   本站刚把所有海外 CDN（Tailwind / Google Fonts / Font Awesome）清掉，
 *   目的就是减少国内访问的故障点。再从 unpkg 引 250KB 的评论组件等于走回头路。
 *   自己托管后，评论区的可用性只取决于你自己的 Waline 服务，不再受第三方 CDN 影响。
 *
 * 版本固定：升级时改下面的 VERSION，重跑本脚本，然后提交 vendor/ 的变化。
 * 之所以要固定版本，是因为评论组件出问题会直接导致读者发不了言，
 * 不能让 CDN 上的 latest 悄悄改变你的线上行为。
 */
const fs = require('fs');
const path = require('path');

const VERSION = '3.15.2';
const OUT_DIR = path.resolve(__dirname, '..', 'vendor', 'waline');

/** 需要的文件。meta 版带图标，是可选的增强样式 */
const FILES = ['waline.umd.js', 'waline.css', 'waline-meta.css'];

async function download(file) {
  const url = `https://unpkg.com/@waline/client@${VERSION}/dist/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file} 下载失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  return buf.length;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`\n  下载 @waline/client@${VERSION} 到 vendor/waline/\n`);

  let total = 0;
  for (const f of FILES) {
    try {
      const size = await download(f);
      total += size;
      console.log(`  ${f.padEnd(18)} ${(size / 1024).toFixed(1).padStart(7)} KB`);
    } catch (err) {
      console.error(`  ${f.padEnd(18)} *** ${err.message}`);
      process.exitCode = 1;
    }
  }

  // 记录来源与版本，方便日后确认这份文件是哪来的
  fs.writeFileSync(
    path.join(OUT_DIR, 'SOURCE.txt'),
    `来源: https://unpkg.com/@waline/client@${VERSION}/dist/\n`
    + `版本: ${VERSION}\n`
    + `下载方式: node tools/build-waline.js\n\n`
    + `这是第三方构建产物，不要手动修改。\n`
    + `升级步骤: 改 tools/build-waline.js 里的 VERSION -> 重跑脚本 -> 提交 vendor/ 的变化\n`
    + `许可证: GPL-2.0 (Waline)\n`,
    'utf8'
  );

  console.log(`\n  合计 ${(total / 1024).toFixed(1)} KB`);
  console.log('  说明: 这些是第三方构建产物，必须提交到仓库（GitHub Pages 不构建）。\n');
})();
