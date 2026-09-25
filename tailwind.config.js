/**
 * Tailwind 配置 —— **全站主题的唯一来源**。
 *
 * 为什么不用 <script src="https://cdn.tailwindcss.com"> 了：
 *   那个 CDN 会在浏览器里现场编译 CSS，首屏多一次跨洋请求 + 一次 JS 编译，
 *   国内经常卡住甚至超时，一旦失败整站样式全丢。
 *   改成预编译后页面只加载一个几 KB 的本地 style.css。
 *
 * 构建:  npm run build:css
 *
 * 注意：本文件被 npm 脚本加载时会把 theme/safelist 导出成 site-theme.js，
 * 供页面内联的 tailwind.config 复用，因此主题定义只此一处，不会出现两套。
 */
const fs = require('fs');
const path = require('path');

const theme = {
  extend: {
    colors: {
      paper: '#FDFBF7',
    },
    fontFamily: {
      // 只用系统内置中文字体，不再请求 fonts.googleapis.com
      // （该域名在国内长期不可用，是首屏白屏的主因之一）
      sans: ['"Noto Sans SC"', '"PingFang SC"', '"Hiragino Sans GB"',
             '"Microsoft YaHei"', '"Source Han Sans SC"', 'system-ui', 'sans-serif'],
      serif: ['"Noto Serif SC"', '"Songti SC"', '"SimSun"', 'Georgia', 'serif'],
    },
    // 说明：Ken Burns 的 @keyframes 刻意不写在 theme.extend 里。
    // Tailwind 只在检测到 animate-kenburns 工具类时才输出主题中的 keyframes，
    // 而这里用的是自定义类 .bg-animate，会导致关键帧被漏掉、动画静默失效。
    // 因此关键帧直接定义在 src/input.css 中，由自己掌控。
  },
};

/**
 * 运行时才拼出来的类名（例如每个技能自己的颜色）静态扫描扫不到，
 * 必须显式列出，否则构建后样式会被 purge 掉。
 */
const safelist = [
  { pattern: /^text-(emerald|blue|yellow|red|purple|pink|indigo|cyan)-(300|400|500|600)$/ },
  { pattern: /^(bg|border|from|to)-(emerald|blue|yellow)-(400|500)$/ },
];

// 供页面内联使用（保持与构建完全一致的主题）
const payload = JSON.stringify({ theme: theme, safelist: safelist }, null, 2);
fs.writeFileSync(
  path.join(__dirname, 'site-theme.js'),
  '/* 由 tailwind.config.js 自动生成，请勿手改。页面用它设置 tailwind.config。 */\n'
  + 'window.__SITE_THEME = ' + payload + ';\n',
  'utf8'
);

module.exports = {
  darkMode: 'class',
  // 含 botanical.js：它在运行时拼出 botanical--grow 这类类名，静态扫描要能看到
  content: ['./index.html', './data.js', './botanical.js'],
  theme: theme,
  safelist: safelist,
  plugins: [],
};
