/**
 * 校验 .vercelignore 的实际效果。
 *
 *   node tools/verify-vercelignore.js
 *
 * 为什么需要它：
 *   1. `.vercelignore` 用的是 gitignore 风格语法，但 git 自己的
 *      `git check-ignore` **只读 .gitignore**，不能用它来验证这个文件。
 *   2. 配错的后果很隐蔽：少忽略一个目录 -> 每次部署多传上百 MB（慢但能跑）；
 *      多忽略一个目录 -> 线上资源 404（页面直接坏）。
 *      后者更危险，所以必须把「被忽略的文件」列出来人工过一眼。
 *
 * 这里不依赖 Vercel CLI，自己实现一遍 gitignore 的基础匹配规则。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORE_FILE = path.join(ROOT, '.vercelignore');

/** 页面运行时真正需要的路径，绝不能被忽略 */
const MUST_KEEP = [
  'index.html', 'style.css', 'data.json', 'data.js', 'icons.js', 'site-theme.js',
  'admin/index.html', 'admin/config.yml',
  'img/bg3.png.webp', 'img/Leafer.jpg.webp',
  'music/1.mp3',
  'vendor/waline/waline.umd.js', 'vendor/waline/waline.css',
  'vercel.json',
];

/** 预期会被忽略的（用于确认忽略规则确实生效） */
const EXPECT_IGNORED = [
  'assets/bg.png', 'me/case1.jpg', 'tools/serve.js',
  '.github/workflows/optimize-images.yml', 'README.md', 'src/input.css',
  'package.json',
];

/** 把一行 gitignore 规则转成正则 */
function toRegex(line) {
  // 去掉行尾空格（未转义的）与注释
  let p = line.replace(/(?<!\\)\s+$/, '');
  if (!p || p.startsWith('#')) return null;

  let negate = false;
  if (p.startsWith('!')) { negate = true; p = p.slice(1); }

  // 结尾的 / 表示"只匹配目录"，这里简化为匹配该前缀
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  // 是否锚定到根：含斜杠（除结尾外）则锚定
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);

  // 转义正则元字符，再把 * 和 ? 还原成通配
  const body = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');

  // 目录规则要同时匹配"该目录本身"和"其下所有内容"
  const suffix = dirOnly ? '(\\/.*)?' : '(/.*)?';
  const prefix = anchored ? '^' : '(^|.*/)';
  return { regex: new RegExp(prefix + body + suffix + '$'), negate };
}

function loadRules() {
  const raw = fs.readFileSync(IGNORE_FILE, 'utf8');
  return raw.split(/\r?\n/).map(toRegex).filter(Boolean);
}

/** 递归列出所有文件（相对路径，正斜杠） */
function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** 判断某个相对路径是否被忽略（后者覆盖前者） */
function isIgnored(rel, rules) {
  let ignored = false;
  for (const r of rules) {
    if (r.regex.test(rel)) ignored = !r.negate;
  }
  return ignored;
}

console.log('\n  ── 校验 .vercelignore ──\n');

if (!fs.existsSync(IGNORE_FILE)) {
  console.error('  找不到 .vercelignore');
  process.exit(1);
}

const rules = loadRules();
console.log(`  规则条数: ${rules.length}`);

const all = walk(ROOT);
const ignored = all.filter((f) => isIgnored(f, rules));
const kept = all.filter((f) => !isIgnored(f, rules));

const mb = (list) => list.reduce((s, f) => s + fs.statSync(path.join(ROOT, f)).size, 0) / 1024 / 1024;

console.log(`  仓库文件总数: ${all.length}  (${mb(all).toFixed(1)} MB)`);
console.log(`  将被上传:     ${kept.length}  (${mb(kept).toFixed(1)} MB)`);
console.log(`  将被忽略:     ${ignored.length}  (${mb(ignored).toFixed(1)} MB)`);

let problems = 0;

// 1) 必需文件不能被杀
console.log('\n  ── 必需文件是否保留 ──');
for (const f of MUST_KEEP) {
  if (!fs.existsSync(path.join(ROOT, f))) continue; // 文件不存在就跳过
  if (isIgnored(f, rules)) {
    console.log('  ✗ 被误忽略，线上会 404: ' + f);
    problems++;
  }
}
if (!problems) console.log('  OK    ' + MUST_KEEP.length + ' 个必需文件全部保留');

// 2) 预期被忽略的确实被忽略了
console.log('\n  ── 预期忽略是否生效 ──');
let missIgnore = 0;
for (const f of EXPECT_IGNORED) {
  if (!fs.existsSync(path.join(ROOT, f))) continue;
  if (!isIgnored(f, rules)) { console.log('  ✗ 未按预期忽略: ' + f); missIgnore++; }
}
if (!missIgnore) console.log('  OK    ' + EXPECT_IGNORED.length + ' 项均被忽略');
problems += missIgnore;

// 3) 列出被忽略的顶层条目，供人工确认
console.log('\n  ── 被忽略的顶层条目（请过目，确认没有误伤）──');
const top = [...new Set(ignored.map((f) => f.split('/')[0]))].sort();
top.forEach((t) => {
  const isDir = fs.existsSync(path.join(ROOT, t)) && fs.statSync(path.join(ROOT, t)).isDirectory();
  const size = isDir
    ? fs.readdirSync(path.join(ROOT, t), { recursive: true })
        .reduce((s, x) => { const p = path.join(ROOT, t, x); return s + (fs.statSync(p).isFile() ? fs.statSync(p).size : 0); }, 0)
    : fs.statSync(path.join(ROOT, t)).size;
  console.log(`     ${t.padEnd(22)} ${(size / 1024 / 1024).toFixed(2)} MB`);
});

console.log('');
if (problems) {
  console.error(`  校验失败：${problems} 处问题\n`);
  process.exit(1);
}
console.log('  校验通过\n');
