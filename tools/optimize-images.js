/**
 * 图片优化脚本 —— 需要 Node 18+ 与 sharp。
 *
 *   npm i sharp
 *   node tools/optimize-images.js
 *
 * 设计原则：**不删除、不覆盖任何原图**。
 * 优化产物统一输出到 img/ 目录，data.js 与 index.html 引用 img/ 下的文件，
 * 因此随时可以直接改回 assets/ 的原始大图（回滚只需改路径）。
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'img');

/**
 * 每类图片的目标尺寸与质量。
 * 依据：页面上这些图的真实显示尺寸
 *   - 背景图层铺满视口，最多 2560 宽已足够，再大肉眼无差别
 *   - 正文配图最大显示宽约 768px，2 倍屏取 1400
 *   - 侧边栏头像显示 96px，取 256 已远超 2 倍屏
 */
const RULES = {
  bg:      { dir: 'assets', files: ['bg.png', 'bg1.png', 'bg2.png', 'bg3.png', 'bg4.png', 'bg5.png'],
             width: 2560, quality: 80 },
  avatar:  { dir: 'assets', files: ['Leafer.jpg'], width: 256, quality: 86 },
  cover:   { dir: 'assets', files: ['TOUHOU.jpg', 'amazarashi1.jpg'], width: 256, quality: 82 },
  aboutMe: { dir: 'me',     files: ['case1.jpg', 'case2.jpg', 'mai1.jpg', 'yj1.jpg'],
             width: 1400, quality: 80 },

  /**
   * 正文配图。
   * pic1 这类高细节照片在 q80 下仍有 515KB，占首屏体积四成，
   * 因此单独降到 q72 / 1280 宽 —— 卡片实际显示宽度只有约 340px（2 倍屏 680px），
   * 1280px 依然远超实际需要，肉眼几乎看不出差别。
   * 张灯结彩、灯笼那种高饱和高频细节的图，WebP 本身就压不太动，
   * 与其牺牲尺寸，不如把质量降到视觉可接受的临界点。
   */
  article: { dir: 'assets', files: ['pic1.jpg', 'pic3.jpg', 'Nanjing1.jpg', 'Nanjing2.jpg', 'Nanjing3.jpg',
                                    'deji1.jpg', 'deji2.jpg', 'shit.jpg', 'neruo.png'],
             width: 1280, quality: 72 },
};

/** assets/Nanjing1.jpg -> img/Nanjing1.jpg.webp */
function outName(src) {
  return path.basename(src) + '.webp';
}

const MANIFEST = {};

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  let before = 0;
  let after = 0;

  for (const [key, rule] of Object.entries(RULES)) {
    for (const file of rule.files) {
      const src = path.join(ROOT, rule.dir, file);
      if (!fs.existsSync(src)) {
        console.warn(`  [跳过] 源文件不存在: ${rule.dir}/${file}`);
        continue;
      }
      const dest = path.join(OUT, outName(file));
      const srcKB = fs.statSync(src).size / 1024;

      // withoutEnlargement: 原图比目标还小时不要放大，避免无意义体积膨胀
      await sharp(src)
        .rotate() // 依据 EXIF 自动转正，手机拍的照片方向才正确
        .resize({ width: rule.width, withoutEnlargement: true })
        .webp({ quality: rule.quality, effort: 6 })
        .toFile(dest);

      const destKB = fs.statSync(dest).size / 1024;
      before += srcKB;
      after += destKB;
      MANIFEST[`${rule.dir}/${file}`] = `img/${outName(file)}`;

      const ratio = ((1 - destKB / srcKB) * 100).toFixed(0);
      console.log(
        `  ${(rule.dir + '/' + file).padEnd(30)} ${srcKB.toFixed(0).padStart(6)} KB` +
        ` -> ${destKB.toFixed(0).padStart(5)} KB  (-${ratio}%)`
      );
    }
  }

  fs.writeFileSync(
    path.join(OUT, 'manifest.json'),
    JSON.stringify(MANIFEST, null, 2),
    'utf8'
  );

  console.log('\n' + '-'.repeat(58));
  console.log(`  合计: ${(before / 1024).toFixed(1)} MB -> ${(after / 1024).toFixed(1)} MB` +
              `  (省下 ${(100 - (after / before) * 100).toFixed(1)}%)`);
  console.log(`  清单: img/manifest.json`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
