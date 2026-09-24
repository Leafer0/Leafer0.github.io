/**
 * 把 data.js 迁移成 data.json。
 *
 *   node tools/migrate-to-json.js
 *
 * 为什么要迁移：
 *   data.js 是「JavaScript 对象字面量」，带注释、单引号、尾逗号。
 *   富文本后台（Sveltia CMS / Decap CMS）需要一个标准 JSON 文件作为数据源，
 *   它才能可靠地读写字段。所以这一步是「网页端写文章」的前置条件。
 *
 * 为什么要写脚本而不是手改：
 *   站点数据里有 60 多个字段、几十个中文长字符串。
 *   手工转换必然出错，而且出错后很难发现（少一个字段页面就少一块内容）。
 *   所以这里自动转换 + 逐字段校验，保证「迁移前后数据完全等价」。
 *
 * 安全性：本脚本**不删除** data.js，也不改动 index.html，
 * 只生成 data.json。页面会在后续步骤里优先读 data.json，
 * 一旦出问题，删掉 data.json 就自动回退到原来的 data.js。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_PATH = path.join(ROOT, 'data.js');
const JSON_PATH = path.join(ROOT, 'data.json');

/** 取出 data.js 里的对象。data.js 是挂全局变量的普通脚本，这里用 eval 求值 */
function loadData() {
  const src = fs.readFileSync(JS_PATH, 'utf8');
  if (!/const\s+SITE_DATA\s*=/.test(src)) {
    throw new Error('data.js 里找不到 `const SITE_DATA =`，请确认文件结构未被改动。');
  }
  // eslint-disable-next-line no-eval
  return eval(src + '\n;SITE_DATA');
}

/**
 * 校验：迁移后的 JSON 必须和原对象逐字段相等。
 * 不比 JSON 字符串，而是递归比结构，这样能给出精确的差异位置。
 */
function diff(a, b, p = '') {
  const problems = [];
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      problems.push(`${p}: 一边是数组一边不是`);
      return problems;
    }
    if (a.length !== b.length) {
      problems.push(`${p}: 数组长度不同 ${a.length} vs ${b.length}`);
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      problems.push(...diff(a[i], b[i], `${p}[${i}]`));
    }
    return problems;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const onlyA = ka.filter((k) => !kb.includes(k));
    const onlyB = kb.filter((k) => !ka.includes(k));
    if (onlyA.length) problems.push(`${p}: 迁移后丢失字段 ${onlyA.join(', ')}`);
    if (onlyB.length) problems.push(`${p}: 迁移后多出字段 ${onlyB.join(', ')}`);
    for (const k of ka.filter((x) => kb.includes(x))) {
      problems.push(...diff(a[k], b[k], `${p}.${k}`));
    }
    return problems;
  }
  if (a !== b) problems.push(`${p}: 值不同\n      原: ${JSON.stringify(a)}\n      新: ${JSON.stringify(b)}`);
  return problems;
}

function main() {
  console.log('\n  读取 data.js ...');
  const original = loadData();

  const json = JSON.stringify(original, null, 2) + '\n';
  fs.writeFileSync(JSON_PATH, json, 'utf8');
  console.log('  写入 data.json');

  // 关键步骤：从磁盘读回来再校验，确认 JSON 是完整可解析的
  const roundTrip = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  console.log('  回读校验 ...');

  const problems = diff(original, roundTrip);

  // 统计
  const stats = {
    顶层字段: Object.keys(roundTrip).length,
    帖子: (roundTrip.articles || []).length,
    历程: (roundTrip.journey || []).length,
    语录: (roundTrip.quotes || []).length,
    背景图: (roundTrip.backgroundImages || []).length,
    音乐: (roundTrip.playlist || []).length,
    关于我段落: (roundTrip.about && roundTrip.about.paragraphs || []).length,
  };
  console.log('\n  ── 迁移结果 ──');
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(12, '　')} ${v}`);
  }
  console.log(`\n  文件大小: ${(fs.statSync(JS_PATH).size / 1024).toFixed(1)} KB (js)`
    + ` -> ${(fs.statSync(JSON_PATH).size / 1024).toFixed(1)} KB (json)`);

  if (problems.length) {
    console.error('\n  [失败] 迁移前后数据不一致，共 ' + problems.length + ' 处:');
    problems.slice(0, 20).forEach((p) => console.error('    - ' + p));
    process.exit(1);
  }
  console.log('\n  校验通过：迁移前后数据完全一致，无字段丢失。\n');
}

main();
