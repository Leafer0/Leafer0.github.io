/**
 * 生成 botanical.js —— 手绘草木纹样的唯一来源。
 *
 *   node tools/build-botanical.js
 *
 * 为什么用生成脚本而不是直接写 botanical.js：
 *   这些路径要按统一坐标系绘制，还要配套生成渲染函数。
 *   集中在此便于校验"路径是否越界、是否为空"，避免多处走偏。
 *
 * 重要：生成的代码全部用**字符串拼接**书写，本文件的模板里不使用任何
 *   ${...} 插值（除数据注入处用占位符替换）。
 *   原因：一旦模板里出现插值，它会在生成脚本运行时被求值，
 *   而那时被插值的变量（如 opts）并不存在 —— 轻则报错，
 *   重则把写死的常量写进产物，导致动画静默失效。
 *   这个坑真实踩过：botanical--grow 始终拼不上，
 *   结果是入场动画只有淡入在跑、描边生长与叶片绽放完全没动。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 路径数据。坐标系见各条目的 viewBox */
const SHAPES = {
  vine: {
    viewBox: '0 0 100 100',
    stroke: ['M4 96 C18 78 26 58 34 36 C40 20 46 10 54 4'],
    fill: [
      'M26 62 C20 52 24 42 34 40 C38 48 36 58 26 62 Z',
      'M36 40 C32 30 36 21 46 19 C50 27 47 37 36 40 Z',
      'M18 78 C11 71 12 61 21 58 C26 65 25 74 18 78 Z',
      'M44 20 C42 11 47 3 57 2 C60 10 56 18 44 20 Z',
      'M31 51 C27 60 18 63 11 58 C15 49 24 46 31 51 Z',
    ],
  },
  blossom: {
    viewBox: '0 0 100 100',
    stroke: [],
    fill: [
      'M50 22 C58 22 62 30 58 38 C66 34 74 38 74 46 C74 54 66 58 58 54 ' +
      'C62 62 58 70 50 70 C42 70 38 62 42 54 C34 58 26 54 26 46 ' +
      'C26 38 34 34 42 38 C38 30 42 22 50 22 Z',
    ],
    circles: [[50, 46, 7]],
  },
  sprig: {
    viewBox: '0 0 100 100',
    stroke: ['M50 96 C50 70 48 40 50 8'],
    fill: [
      'M50 74 C42 70 38 62 42 55 C50 58 54 66 50 74 Z',
      'M50 76 C58 72 62 64 58 57 C50 60 46 68 50 76 Z',
      'M50 52 C42 48 38 40 42 33 C50 36 54 44 50 52 Z',
      'M50 54 C58 50 62 42 58 35 C50 38 46 46 50 54 Z',
      'M50 30 C42 26 38 18 42 11 C50 14 54 22 50 30 Z',
      'M50 32 C58 28 62 20 58 13 C50 16 46 24 50 32 Z',
    ],
  },
  fern: {
    viewBox: '0 0 100 100',
    stroke: ['M8 92 C30 74 52 48 72 14'],
    fill: [
      'M20 82 C10 82 4 74 8 66 C18 68 24 74 20 82 Z',
      'M30 70 C20 70 14 62 18 54 C28 56 34 62 30 70 Z',
      'M41 58 C31 58 25 50 29 42 C39 44 45 50 41 58 Z',
      'M52 45 C42 45 36 37 40 29 C50 31 56 37 52 45 Z',
      'M62 32 C52 32 46 24 50 16 C60 18 66 24 62 32 Z',
      'M26 76 C24 86 15 90 8 85 C12 76 21 72 26 76 Z',
      'M37 64 C35 74 26 78 19 73 C23 64 32 60 37 64 Z',
      'M48 51 C46 61 37 65 30 60 C34 51 43 47 48 51 Z',
      'M59 38 C57 48 48 52 41 47 C45 38 54 34 59 38 Z',
    ],
  },
  divider: {
    viewBox: '0 0 240 40',
    stroke: ['M0 20 C40 20 70 12 100 20 C130 28 160 28 190 20 C212 14 228 18 240 20'],
    fill: [
      'M74 15 C68 8 70 1 78 0 C83 6 82 13 74 15 Z',
      'M166 25 C172 32 170 39 162 40 C157 34 158 27 166 25 Z',
    ],
    circles: [[100, 20, 4], [190, 20, 3]],
  },
  cornerCluster: {
    viewBox: '0 0 200 200',
    stroke: [
      'M6 194 C30 150 40 108 46 62 C50 34 60 14 78 4',
      'M46 62 C70 56 96 52 122 26',
    ],
    fill: [
      'M52 130 C36 126 28 110 36 94 C54 98 64 114 52 130 Z',
      'M62 88 C46 84 38 68 46 52 C64 56 74 72 62 88 Z',
      'M74 42 C58 38 50 22 58 6 C76 10 86 26 74 42 Z',
      'M78 132 C94 128 102 112 94 96 C76 100 66 116 78 132 Z',
      'M96 96 C112 92 120 76 112 60 C94 64 84 80 96 96 Z',
      'M116 56 C132 52 140 36 132 20 C114 24 104 40 116 56 Z',
      'M120 26 C130 16 132 2 124 0 C112 4 108 16 120 26 Z',
    ],
    circles: [[140, 34, 7], [158, 20, 5], [30, 158, 5]],
  },
};

// ---------------------------------------------------------------
// 校验
// ---------------------------------------------------------------
let problems = 0;
function fail(msg) { problems++; console.error('  ✗ ' + msg); }

function dims(vb) {
  const p = vb.split(/\s+/).map(Number);
  return { w: p[2], h: p[3] };
}

function coords(d) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g;
  let m;
  while ((m = re.exec(d))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

console.log('\n  ── 校验纹样路径 ──\n');
Object.keys(SHAPES).forEach(function (name) {
  const s = SHAPES[name];
  const d0 = dims(s.viewBox);
  const stroke = s.stroke || [];
  const fill = s.fill || [];
  if (!stroke.length && !fill.length) fail(name + ': stroke 与 fill 都为空');

  const all = stroke.concat(fill);
  for (let i = 0; i < all.length; i++) {
    const d = all[i];
    if (!/^\s*M/.test(d)) fail(name + ': 路径未以 M 开头 -> ' + d.slice(0, 30));
    const tol = 0.35;
    const cs = coords(d);
    for (let j = 0; j < cs.length; j++) {
      const x = cs[j][0], y = cs[j][1];
      if (x < -d0.w * tol || x > d0.w * (1 + tol) || y < -d0.h * tol || y > d0.h * (1 + tol)) {
        fail(name + ': 坐标 (' + x + ',' + y + ') 超出 viewBox ' + s.viewBox + ' 过多');
        break;
      }
    }
  }
  console.log('  ' + name.padEnd(16) + ' viewBox=' + s.viewBox.padEnd(14)
    + ' stroke=' + String(stroke.length).padStart(2)
    + ' fill=' + String(fill.length).padStart(2)
    + ' 路径长度=' + all.join('').length);
});

if (problems) {
  console.error('\n  校验失败：' + problems + ' 处问题\n');
  process.exit(1);
}
console.log('\n  路径校验通过');

// ---------------------------------------------------------------
// 生成（全部用字符串拼接，模板内无任何 ${} 插值）
// ---------------------------------------------------------------
const header = [
  '/**',
  ' * ============================================================',
  ' *  手绘草木纹样（内联 SVG）—— 由 tools/build-botanical.js 生成',
  ' * ============================================================',
  ' *  请勿手改本文件；要改纹样请改 tools/build-botanical.js 后重新生成：',
  ' *      node tools/build-botanical.js',
  ' *',
  ' *  为什么用 SVG 而不是贴图：',
  ' *    - 任意缩放都清晰（手机 3 倍屏、大屏 4K 都不糊）',
  ' *    - 体积只有几 KB，比一张 PNG 边框小两个数量级',
  ' *    - 颜色用 CSS 变量控制，深色模式不必另做一套图',
  ' *    - 支持"路径描边生长"动画 —— 入场动画正需要这个',
  ' *',
  ' *  每个纹样的坐标系见各自 viewBox，使用时靠 viewBox 缩放，',
  ' *  不要假定像素尺寸。',
  ' * ============================================================',
  ' */',
  '',
].join('\n');

const fnSource = [
  '/**',
  ' * 渲染一个纹样为 SVG 字符串。',
  ' *',
  ' * @param {string} name      纹样名（vine / blossom / sprig / fern / divider / cornerCluster）',
  ' * @param {object} [opts]',
  ' * @param {string} [opts.className] 附加 class',
  ' * @param {boolean} [opts.grow]     是否启用"描边生长"动画（入场用）',
  ' * @param {number} [opts.delay]     动画延迟（秒）',
  ' */',
  'function botanical(name, opts) {',
  '  opts = opts || {};',
  '  const s = BOTANICAL[name];',
  "  if (!s) return '';",
  '',
  '  // botanical--grow 是"描边生长 + 叶片绽放"动画的开关，',
  '  // 由 CSS 里的 .botanical--grow .bot-stroke / .bot-fill 选中。',
  '  const cls = [',
  "    'botanical',",
  "    'botanical-' + name,",
  "    opts.grow ? 'botanical--grow' : '',",
  "    opts.className || ''",
  "  ].filter(Boolean).join(' ');",
  '',
  '  const parts = [];',
  '',
  '  // 描边部分：主茎线条，row 用于"生长"动画',
  '  (s.stroke || []).forEach(function (d, i) {',
  "    const style = opts.grow",
  "      ? ' style=\"animation-delay:' + ((opts.delay || 0) + i * 0.15) + 's\"'",
  "      : '';",
  "    parts.push('<path class=\"bot-stroke\" d=\"' + d + '\" fill=\"none\"'",
  "      + ' stroke=\"currentColor\" stroke-width=\"2.2\"'",
  "      + ' stroke-linecap=\"round\" stroke-linejoin=\"round\"' + style + '/>');",
  '  });',
  '',
  '  // 填充部分：叶片与花瓣',
  '  (s.fill || []).forEach(function (d, i) {',
  "    const style = opts.grow",
  "      ? ' style=\"animation-delay:' + ((opts.delay || 0) + 0.25 + i * 0.08) + 's\"'",
  "      : '';",
  "    parts.push('<path class=\"bot-fill\" d=\"' + d + '\" fill=\"currentColor\"'",
  "      + ' fill-opacity=\"0.55\"' + style + '/>');",
  '  });',
  '',
  '  // 花朵与果实圆点',
  '  (s.circles || []).forEach(function (c, i) {',
  "    const style = opts.grow",
  "      ? ' style=\"animation-delay:' + ((opts.delay || 0) + 0.5 + i * 0.1) + 's\"'",
  "      : '';",
  "    parts.push('<circle class=\"bot-dot\" cx=\"' + c[0] + '\" cy=\"' + c[1]",
  "      + '\" r=\"' + c[2] + '\" fill=\"currentColor\" fill-opacity=\"0.85\"' + style + '/>');",
  '  });',
  '',
  "  return '<svg class=\"' + cls + '\" viewBox=\"' + s.viewBox + '\"'",
  "    + ' fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"'",
  "    + ' aria-hidden=\"true\" focusable=\"false\">' + parts.join('') + '</svg>';",
  '}',
  '',
  '// 必须显式挂到 window。',
  '// 只写 function 声明在普通脚本里虽然也会成为全局对象属性，',
  '// 但一旦脚本被包进严格模式或模块作用域就不再可靠 ——',
  '// icons.js 一直用的就是显式赋值，这里保持一致。',
  '// （漏掉这两行会让模板里的 botanical(...) 抛错，',
  '//   而 Vue 会静默放弃挂载，界面上只表现为白屏，极难排查。）',
  'window.BOTANICAL = BOTANICAL;',
  'window.botanical = botanical;',
  '',
].join('\n');

const content = header
  + 'const BOTANICAL = __DATA__;\n\n'
  + fnSource;

const out = content.replace('__DATA__', JSON.stringify(SHAPES, null, 2));

fs.writeFileSync(path.join(ROOT, 'botanical.js'), out, 'utf8');
console.log('  写入 botanical.js  (' + (out.length / 1024).toFixed(1) + ' KB)');
console.log('  纹样数: ' + Object.keys(SHAPES).length + '\n');
