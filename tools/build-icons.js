/**
 * 从 @fortawesome 官方包提取所需图标的 SVG path 数据，生成 icons.js。
 *
 *   npm i @fortawesome/free-brands-svg-icons @fortawesome/free-solid-svg-icons
 *   node tools/build-icons.js
 *
 * 这样做的原因：
 *  1. 原来的 <link> 引用 font-awesome CDN 约 1.2MB 且在国内常被墙；
 *     内联 SVG 只需不到 10KB，无额外请求，且支持 currentColor 跟随主题变色。
 *  2. 原来 navItems 里的 'fas fa-user-leaf' 在 FA6 中并不存在，
 *     导致"关于我"图标渲染为空白 —— 内联方案能从源头避免这类拼写错误。
 *  3. 不再依赖 webfont，也就没有 FOIT/字体加载闪烁。
 */
const fs = require('fs');
const path = require('path');

const brands = require('@fortawesome/free-brands-svg-icons');
const solid = require('@fortawesome/free-solid-svg-icons');

const ROOT = path.resolve(__dirname, '..');

/**
 * 图标清单：输出名 -> [图标包, 图标名]
 *
 * Font Awesome 部分。凡是 data.js / index.html 里用到的图标都必须登记在这里，
 * 否则重新生成 icons.js 时会被丢掉。
 */
const ICONS = {
  'user':           [solid,  'faUser'],
  'mountain':       [solid,  'faMountain'],
  'feather':        [solid,  'faFeather'],
  'envelope':       [solid,  'faEnvelope'],
  'rss':            [solid,  'faRss'],
  'sun':            [solid,  'faSun'],
  'moon':           [solid,  'faMoon'],
  'bars':           [solid,  'faBars'],
  'times':          [solid,  'faXmark'],
  'music':          [solid,  'faMusic'],
  'play':           [solid,  'faPlay'],
  'pause':          [solid,  'faPause'],
  'backward':       [solid,  'faBackwardStep'],
  'forward':        [solid,  'faForwardStep'],
  'chevron-up':     [solid,  'faChevronUp'],
  'arrow-right':    [solid,  'faArrowRight'],
  'chart-line':     [solid,  'faChartLine'],
  'volume':         [solid,  'faVolumeHigh'],
  'github':         [brands, 'faGithub'],
};

/**
 * 技术栈图标直接内联。
 * 这些原本来自 Font Awesome 的 fab，但 FA 从 6 开始移除了品牌技术图标，
 * 所以改用 Simple Icons 的 path 数据（CC0 1.0，可自由使用）硬编码在此，
 * 避免为了 3 个图标再引入一个依赖。
 * 注意 viewBox 是 24×24，与 Font Awesome 的 512 不同。
 */
const TECH_ICONS = {
  vue: {
    viewBox: '0 0 24 24',
    d: ['M24,1.61H14.06L12,5.16,9.94,1.61H0L12,22.39ZM12,14.08,5.16,2.23H9.59L12,6.41l2.41-4.18h4.43Z'],
  },
  js: {
    viewBox: '0 0 24 24',
    d: ['M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z'],
  },
  css: {
    viewBox: '0 0 24 24',
    d: ['M1.5 0h21l-1.91 21.563L11.977 24l-8.565-2.438L1.5 0zm17.09 4.413L5.41 4.41l.213 2.622 10.125.002-.255 2.716h-6.64l.24 2.573h6.182l-.366 3.523-2.91.804-2.956-.81-.188-2.11h-2.61l.29 3.855L12 19.288l5.373-1.53L18.59 4.414z'],
  },
};

/**
 * 交叉校验：找出页面实际引用到的图标名，确认都已登记。
 *
 * 两个来源都要看：
 *  1. index.html 里的字面量调用 icon('bars')
 *  2. data.js 里 icon 字段的值（'user' / 'mountain' / 'feather' / 'github' ...）
 *     —— 这些是通过数据传到模板的，只扫字面量调用会漏掉
 *  3. index.html 里三元表达式中的图标名 icon(isDark ? 'sun' : 'moon')
 *
 * 目的：一旦图标名写错，构建时立刻报错，
 * 而不是等上线后才发现某处图标是空白 —— 之前那个不存在的
 * 'fas fa-user-leaf' 就是这么漏过去的。
 */
function auditUsage(registered) {
  const used = new Set();

  const htmlPath = path.join(ROOT, 'index.html');
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    // 匹配 icon(...) 里出现的所有单引号字符串，一并覆盖三元表达式
    const callRe = /icon\(([^)]*)\)/g;
    let m;
    while ((m = callRe.exec(html))) {
      const args = m[1];
      const strRe = /['"]([\w-]+)['"]/g;
      let s;
      while ((s = strRe.exec(args))) used.add(s[1]);
    }
  }

  const dataPath = path.join(ROOT, 'data.js');
  if (fs.existsSync(dataPath)) {
    const data = fs.readFileSync(dataPath, 'utf8');
    // data.js 里的 icon: 'xxx' 字段
    const fieldRe = /icon:\s*['"]([\w-]+)['"]/g;
    let m;
    while ((m = fieldRe.exec(data))) used.add(m[1]);
  }

  const missing = [...used].filter((n) => !registered.includes(n));
  const unused = registered.filter((n) => !used.has(n));
  return { used: [...used].sort(), missing, unused: unused.sort() };
}


function extract(pack, key, outName) {
  const def = pack[key];
  if (!def) {
    console.error(`  [缺失] ${outName}: 在图标包中找不到 ${key}`);
    process.exitCode = 1;
    return null;
  }
  const [width, height, , , pathData] = def.icon;
  return {
    name: outName,
    viewBox: `0 0 ${width} ${height}`,
    // path 可能是字符串，也可能是字符串数组（多段路径）
    d: Array.isArray(pathData) ? pathData : [pathData],
  };
}

const results = [];
for (const [outName, [pack, key]] of Object.entries(ICONS)) {
  const icon = extract(pack, key, outName);
  if (icon) {
    results.push(icon);
    console.log(`  ok  ${outName.padEnd(14)} ${(icon.d.join('').length / 1024).toFixed(2)} KB`);
  }
}

// 内联登记的技术栈图标
for (const [name, def] of Object.entries(TECH_ICONS)) {
  results.push({ name, viewBox: def.viewBox, d: def.d });
  console.log(`  ok  ${name.padEnd(14)} ${(def.d.join('').length / 1024).toFixed(2)} KB  (simple-icons)`);
}

// 校验页面与数据里用到的图标是否都已登记
const audit = auditUsage(results.map((r) => r.name));
console.log(`\n  代码中实际用到 ${audit.used.length} 个图标: ${audit.used.join(', ')}`);
if (audit.unused.length) {
  console.log(`  未被引用（可留作备用）: ${audit.unused.join(', ')}`);
}
if (audit.missing.length) {
  console.error(`  [错误] 以下图标被引用但没有登记，重新生成后会是空白: ${audit.missing.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  全部已登记，无遗漏。');
}

const banner = `/**
 * 内联 SVG 图标集 —— 由 tools/build-icons.js 自动生成，请勿手改。
 *
 * 数据来源:
 *   Font Awesome Free (CC BY 4.0 / SIL OFL 1.1 / MIT)  —— 界面与品牌图标
 *   Simple Icons (CC0 1.0)                              —— Vue / JS / CSS 图标
 *
 * 用法:
 *   <span v-html="icon('github')"></span>
 *   <span v-html="icon('bars', 'w-5 h-5')"></span>
 *
 * 输出为挂到 window 上的全局函数，与 data.js 的全局风格保持一致，
 * 页面无需模块化即可直接使用。
 */
`;

// 全局版（页面直接 <script> 引入）
const shared = `const ICONS = ${JSON.stringify(
  Object.fromEntries(results.map((r) => [r.name, { viewBox: r.viewBox, d: r.d }])),
  null,
  2
)};
function icon(name, className) {
  className = className || '';
  const def = ICONS[name];
  if (!def) return '';
  const paths = def.d.map(function (d) { return '<path d="' + d + '"/>'; }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + def.viewBox +
    '" fill="currentColor" aria-hidden="true" focusable="false"' +
    (className ? ' class="' + className + '"' : '') + '>' + paths + '</svg>';
}
`;

fs.writeFileSync(path.join(ROOT, 'icons.js'), banner + shared + '\nwindow.ICONS = ICONS;\nwindow.icon = icon;\n', 'utf8');
console.log('\n  写入 icons.js');
