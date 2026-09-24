/**
 * 校验 admin/config.yml 是否覆盖了 data.json 的全部字段。
 *
 *   node tools/verify-cms-config.js
 *
 * 为什么必须校验：
 *   CMS 保存内容时，会**按 config.yml 的字段定义重写整个 data.json**。
 *   配置里没声明的字段会被静默丢掉 —— 比如忘记配 navItems，
 *   下次在后台保存一次帖子，导航栏就永久消失了，而且没有任何报错。
 *   所以这里把「数据里有的字段」和「配置里有的字段」逐层对齐检查。
 *
 * 依赖：js-yaml（npm i -D js-yaml）
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'admin', 'config.yml');
const DATA = path.join(ROOT, 'data.json');

if (!fs.existsSync(CONFIG)) {
  console.error('找不到 admin/config.yml');
  process.exit(1);
}
if (!fs.existsSync(DATA)) {
  console.error('找不到 data.json，请先运行: node tools/migrate-to-json.js');
  process.exit(1);
}

const config = yaml.load(fs.readFileSync(CONFIG, 'utf8'));
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

/** 把 config.yml 里所有 file 集合的 fields 收集成一张「已声明字段名」的表 */
function collectDeclaredFields(fields, into = new Set()) {
  for (const f of fields || []) {
    if (f.name) into.add(f.name);
    // 嵌套对象
    if (f.fields) collectDeclaredFields(f.fields, into);
    // 多类型列表（关于我的段落用了这个）
    if (f.types) {
      for (const t of f.types) collectDeclaredFields(t.fields, into);
    }
  }
  return into;
}

const declared = new Set();
const files = [];
for (const c of config.collections || []) {
  for (const file of c.files || []) {
    files.push({ collection: c.label || c.name, file: file.file, label: file.label });
    collectDeclaredFields(file.fields, declared);
  }
}

/**
 * 递归比对：data.json 里出现的字段名，是否都在 config 里声明过。
 * 只检查「名字有没有被声明」，不检查 widget 类型对不对 ——
 * 类型错误 CMS 自己会报，而漏声明是静默数据丢失，危害更大。
 */
const problems = [];

function check(obj, trail) {
  if (Array.isArray(obj)) {
    // 数组：拿第一个元素当样本，检查列表项内部字段
    if (obj.length && obj[0] && typeof obj[0] === 'object') {
      check(obj[0], trail + '[]');
    }
    return;
  }
  if (!obj || typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    if (!declared.has(key)) {
      problems.push(`${trail}.${key}   （值类型: ${Array.isArray(value) ? 'array' : typeof value}）`);
    }
    check(value, trail + '.' + key);
  }
}

check(data, 'data');

console.log('\n  ── 校验 admin/config.yml 字段覆盖 ──\n');
console.log(`  配置里的集合: ${(config.collections || []).length} 个`);
for (const f of files) {
  console.log(`     ${String(f.collection).padEnd(14)} -> ${f.file}`);
}
console.log(`\n  配置声明的字段名: ${declared.size} 个`);
console.log(`  data.json 顶层字段: ${Object.keys(data).length} 个`);

if (problems.length) {
  console.error(`\n  [失败] data.json 里有 ${problems.length} 个字段没在 config.yml 中声明。`);
  console.error('  这意味着：在后台保存任何内容时，这些字段会被丢掉！\n');
  problems.forEach((p) => console.error('     ✗ ' + p));
  console.error('\n  请到 admin/config.yml 里补上对应字段后重新校验。\n');
  process.exit(1);
}

console.log('\n  校验通过：data.json 的所有字段都已在 config.yml 中声明，');
console.log('  在后台保存内容不会造成字段丢失。\n');
