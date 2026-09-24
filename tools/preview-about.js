/**
 * 在终端里预览"关于我"的文案，并做几项写作质量检查。
 *
 *   node tools/preview-about.js
 *
 * 为什么需要它：文案改完后不必每次都开浏览器，
 * 这里能直接看到分段效果、字数和主语密度。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 与页面保持一致：优先读 data.json（/admin 后台写的就是它），读不到才回退 data.js。
 * 否则你用后台改完文案，再跑这个脚本，看到的还是旧的 data.js，白忙一场。
 */
function loadSiteData() {
  const jsonPath = path.join(ROOT, 'data.json');
  if (fs.existsSync(jsonPath)) {
    return { data: JSON.parse(fs.readFileSync(jsonPath, 'utf8')), from: 'data.json' };
  }
  return {
    data: eval(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8') + '\n;SITE_DATA'),
    from: 'data.js',
  };
}

const loaded = loadSiteData();
const SITE_DATA = loaded.data;

const paras = SITE_DATA.about.paragraphs;
const texts = paras.filter((p) => p.type === 'text');

console.log('\n============ 文案预览 ============');
console.log('（数据来源: ' + loaded.from + '）\n');
for (const p of paras) {
  if (p.type === 'heading') {
    console.log('\n■ ' + p.value + '\n');
  } else if (p.type === 'text') {
    console.log('  ' + p.value);
  } else if (p.type === 'gallery') {
    console.log('  〔配图 ' + p.images.length + ' 张：'
      + p.images.map((i) => i.caption).join('、') + '〕');
  }
}

console.log('\n============ 质量检查 ============\n');
console.log('  段落总数   ' + paras.length
  + '（正文 ' + texts.length + ' / 小标题 ' + paras.filter((p) => p.type === 'heading').length
  + ' / 配图 ' + paras.filter((p) => p.type === 'gallery').length + '）');

const allText = texts.map((p) => p.value).join('');
console.log('  正文总字数 ' + allText.length);

// 平均句长：太长说明还是书面语。
// 冒号、顿号、分号也算停顿（口语里这些位置人是要换气的），
// 只按句号切会把长句算短，反而掩盖问题。
const sentences = allText.split(/[。！？；：、，]/).filter((s) => s.trim().length);
const avgLen = sentences.reduce((s, x) => s + x.length, 0) / sentences.length;
const longest = sentences.reduce((a, b) => (b.length > a.length ? b : a), '');
console.log('  平均句长   ' + avgLen.toFixed(1) + ' 字（按全部停顿切分）'
  + (avgLen < 14 ? '  OK' : '  仍偏长'));
console.log('  最长停顿块 ' + longest.length + ' 字：' + longest.trim());

// 主语密度：尽量少用"我"
const withWo = texts.filter((p) => p.value.includes('我')).length;
console.log('  含"我"段落 ' + withWo + ' / ' + texts.length
  + '（' + Math.round((withWo / texts.length) * 100) + '%）');

const woCount = (allText.match(/我/g) || []).length;
console.log('  "我"出现次数 ' + woCount
  + '，每百字 ' + (woCount / allText.length * 100).toFixed(1) + ' 次');

// 检查是否残留过于书面的连接词
const stiffWords = ['极其', '些许', '均有', '涉猎', '之谓', '亦', '颇为', '尚可'];
const found = stiffWords.filter((w) => allText.includes(w));
console.log('  书面语残留 ' + (found.length ? found.join('、') + '  <-- 建议再口语化' : '无'));

console.log('');
