/**
 * 校验 vercel.json 是否符合 Vercel 的配置约束。
 *
 *   node tools/verify-vercel-config.js
 *
 * 为什么需要它：
 *   Vercel 对配置文件里的未知键是**直接拒绝**的。
 *   如果写了它不认识的字段（例如习惯性地加个 "comment" 做说明），
 *   整个部署会失败。而这个错误只在部署时暴露，本地很难发现。
 *
 * 这里做三件事：
 *   1. 确认是合法 JSON（顺带避免用错编码的读取工具造成误判）
 *   2. 确认顶层键都在 Vercel 允许的列表里
 *   3. 确认每条 header 规则的结构正确
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'vercel.json');

/** 允许的顶层键。来自 https://openapi.vercel.sh/vercel.json */
const ALLOWED_TOP_KEYS = [
  '$schema', 'alias', 'build', 'builds', 'skipMiddlewareRequestBody', 'cleanUrls',
  'env', 'passiveRegions', 'functionFailoverRegions', 'functions', 'git', 'github',
  'headers', 'images', 'name', 'redirects', 'bulkRedirectsPath', 'regions',
  'rewrites', 'routes', 'scope', 'trailingSlash', 'version', 'wildcard',
  'buildCommand', 'ignoreCommand', 'devCommand', 'framework', 'installCommand',
  'outputDirectory', 'crons', 'schedules', 'relatedProjects', 'fluid',
  'bunVersion', 'proxy', 'experimentalAtproto', 'experimentalBYOC',
  'experimentalEnvironmentVariables', 'experimentalServices',
  'experimentalServiceGroups', 'services', 'experimentalServicesV2',
];

/** 允许出现在单条 header 规则里的键 */
const ALLOWED_RULE_KEYS = ['source', 'headers', 'has', 'missing', 'locale'];

let problems = 0;
const fail = (msg) => { problems++; console.error('  ✗ ' + msg); };
const ok = (msg) => console.log('  OK    ' + msg);

console.log('\n  ── 校验 vercel.json ──\n');

let raw;
try {
  // 必须显式按 UTF-8 读取。某些环境（含中文的 Windows PowerShell）
  // 会按 GBK 解析，导致 JSON.parse 报"应为 : 或 }"，那是读取问题不是文件问题。
  raw = fs.readFileSync(FILE, 'utf8');
} catch (err) {
  console.error('  读不到 vercel.json: ' + err.message);
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(raw);
  ok('是合法的 JSON');
} catch (err) {
  fail('JSON 解析失败: ' + err.message);
  process.exit(1);
}

// 顶层键检查
const unknown = Object.keys(cfg).filter((k) => !ALLOWED_TOP_KEYS.includes(k));
if (unknown.length) {
  fail('出现 Vercel 不认识的顶层键，会导致部署被拒: ' + unknown.join(', '));
} else {
  ok('顶层键全部合法: ' + Object.keys(cfg).join(', '));
}

// headers 结构检查
if (cfg.headers) {
  if (!Array.isArray(cfg.headers)) {
    fail('headers 必须是数组');
  } else {
    cfg.headers.forEach((rule, i) => {
      const where = `headers[${i}]`;
      const badKeys = Object.keys(rule).filter((k) => !ALLOWED_RULE_KEYS.includes(k));
      if (badKeys.length) fail(`${where} 含不允许的键: ${badKeys.join(', ')}`);
      if (!rule.source) fail(`${where} 缺少 source`);
      if (!Array.isArray(rule.headers) || !rule.headers.length) {
        fail(`${where} 缺少 headers 数组`);
      } else {
        rule.headers.forEach((h, j) => {
          if (!h.key || !h.value) fail(`${where}.headers[${j}] 必须同时有 key 和 value`);
        });
      }
    });
    if (!problems) ok(`headers 共 ${cfg.headers.length} 条规则，结构正确`);
  }
}

// 检查我们依赖的关键缓存策略是否都在
const sources = (cfg.headers || []).map((r) => r.source);
const required = ['/data.json', '/style.css'];
for (const r of required) {
  if (sources.includes(r)) ok(`已为 ${r} 单独设置缓存策略`);
  else fail(`缺少 ${r} 的缓存策略（会导致内容更新不及时）`);
}

console.log('');
if (problems) {
  console.error(`  校验失败：${problems} 处问题\n`);
  process.exit(1);
}
console.log('  校验通过：配置可以被 Vercel 接受\n');
