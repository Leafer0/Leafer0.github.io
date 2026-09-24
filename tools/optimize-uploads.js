/**
 * 压缩 img/ 目录下新上传的图片（配合 GitHub Action 自动运行）。
 *
 *   node tools/optimize-uploads.js
 *
 * 为什么需要它：
 *   你在 /admin 后台上传的是手机原图，动辄 3～8 MB。
 *   如果直接进仓库，仓库会迅速膨胀，访客也要等半天。
 *   这个脚本把它们压成几百 KB 的 WebP。
 *
 * 与 optimize-images.js 的分工：
 *   optimize-images.js  —— 处理仓库里那批固定的老图（assets/ -> img/）
 *   optimize-uploads.js —— 处理今后通过后台上传的新图（img/ 里原地处理）
 *
 * 处理策略（关键是「不改动文件名」）：
 *   把 img/xxx.jpg 压成 img/xxx.jpg.webp，
 *   然后删掉原图 xxx.jpg，并把 data.json 里的引用改成 xxx.jpg.webp。
 *   文件名里保留了原后缀，是为了让后台仍能匹配到上传记录 —— 
 *   如果直接改成 xxx.webp，后台会认为这张图"不存在了"。
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'img');
const DATA = path.join(ROOT, 'data.json');

/** 已经压过的（已经是 webp 的）跳过 */
const SOURCE_EXT = ['.jpg', '.jpeg', '.png'];

/**
 * 按用途决定尺寸与质量。
 * 判断依据是文件名/引用路径里的线索，猜不到就用默认值。
 * 默认 1600 宽 / q78 对博客配图已经足够（卡片显示宽度约 340px，2 倍屏 680px）。
 */
function presetFor(name) {
  const n = name.toLowerCase();
  if (/^bg\d*\./.test(n) || n.includes('/bg')) {
    return { width: 2560, quality: 80, note: '背景图' };
  }
  if (n.includes('avatar') || n.includes('leafer')) {
    return { width: 256, quality: 86, note: '头像' };
  }
  return { width: 1600, quality: 78, note: '正文配图' };
}

async function main() {
  if (!fs.existsSync(IMG)) {
    console.log('  img/ 目录不存在，无需处理。');
    return;
  }

  const files = fs.readdirSync(IMG).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    // 跳过已经是优化产物的（xxx.jpg.webp 的后缀是 .webp）
    if (ext === '.webp') return false;
    return SOURCE_EXT.includes(ext);
  });

  if (!files.length) {
    console.log('  没有发现需要压缩的新图片。');
    return;
  }

  console.log(`\n  发现 ${files.length} 张未压缩图片，开始处理...\n`);

  let dataRaw = fs.existsSync(DATA) ? fs.readFileSync(DATA, 'utf8') : '';
  let totalBefore = 0;
  let totalAfter = 0;
  const renamed = [];

  for (const file of files) {
    const src = path.join(IMG, file);
    const before = fs.statSync(src).size;
    const preset = presetFor(file);

    // 产物文件名：保留原名再加 .webp，方便后台匹配
    const outName = file + '.webp';
    const dest = path.join(IMG, outName);

    try {
      await sharp(src)
        .rotate() // 依 EXIF 转正，手机照片方向才正确
        .resize({ width: preset.width, withoutEnlargement: true })
        .webp({ quality: preset.quality, effort: 5 })
        .toFile(dest);
    } catch (err) {
      console.error(`  [跳过] ${file} 处理失败: ${err.message}`);
      continue;
    }

    const after = fs.statSync(dest).size;
    totalBefore += before;
    totalAfter += after;

    // 删除原图，避免仓库里同时存在两份
    fs.unlinkSync(src);
    renamed.push({ from: file, to: outName });

    const pct = ((1 - after / before) * 100).toFixed(0);
    console.log(`  ${file.padEnd(34)} ${(before / 1024).toFixed(0).padStart(5)} KB`
      + ` -> ${(after / 1024).toFixed(0).padStart(4)} KB  (-${pct}%)  [${preset.note}]`);
  }

  // 回写 data.json 里的引用。
  // 必须实际统计替换次数：如果这张图还没被任何内容引用（比如传了但没插入），
  // 就如实说明"未引用"，而不是无论替换没替换都报"已更新"。
  if (dataRaw) {
    let changed = 0;
    let notReferenced = [];
    for (const { from, to } of renamed) {
      const needleFrom = `img/${from}`;
      const needleTo = `img/${to}`;
      const hits = dataRaw.split(needleFrom).length - 1;
      if (hits > 0) {
        dataRaw = dataRaw.split(needleFrom).join(needleTo);
        changed += hits;
        console.log(`  引用已更新  img/${from} -> img/${to}  (${hits} 处)`);
      } else {
        notReferenced.push(from);
      }
    }
    if (changed) {
      fs.writeFileSync(DATA, dataRaw, 'utf8');
      console.log(`\n  data.json 共更新 ${changed} 处引用`);
    }
    if (notReferenced.length) {
      console.log(`  以下图片尚未被内容引用（压缩产物已就绪，插入时会用到）:`
        + ` ${notReferenced.join(', ')}`);
    }
    if (!changed && !notReferenced.length) {
      console.log('  data.json 无需改动');
    }
  }

  if (totalBefore) {
    console.log(`\n  合计: ${(totalBefore / 1024 / 1024).toFixed(1)} MB`
      + ` -> ${(totalAfter / 1024 / 1024).toFixed(1)} MB`
      + `  (省下 ${(100 - (totalAfter / totalBefore) * 100).toFixed(0)}%)`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
