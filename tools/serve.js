/**
 * 本地预览服务器 —— 用来在提交前验证站点。
 *
 *   node tools/serve.js [端口]
 *
 * 两个刻意的设计，都是为了"本地通过 = 线上通过"：
 *
 * 1. **字节精确匹配路径**（不做 URL 解码后的存在性猜测）：
 *    GitHub Pages 跑在 Linux 上，文件名区分大小写。
 *    而 Windows 的 NTFS 默认大小写不敏感，所以
 *    `assets/nanjing1.jpg` 在本地能打开、推上去就 404。
 *    这里对路径做严格的逐段核对，把这类问题在本地就暴露出来。
 *
 * 2. **缺少文件时返回 404 并打印警告**，而不是像很多简易服务器那样
 *    静默回退到 index.html —— 否则资源 404 会被掩盖成"页面看起来正常"。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8899;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 逐段解析真实文件名，大小写不匹配就返回 null。
 * 这样 Windows 上也能模拟出 Linux 的区分大小写行为。
 */
function resolveExact(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const parts = decoded.split('/').filter(Boolean);
  let current = ROOT;

  for (const part of parts) {
    if (part === '..') return null;
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return null;
    }
    // 必须精确相等 —— 这就是和 Windows 默认行为的区别所在
    if (!entries.includes(part)) {
      const near = entries.find((e) => e.toLowerCase() === part.toLowerCase());
      if (near) {
        console.warn(`  [大小写不符] ${urlPath}  ->  磁盘上实际是 "${near}"`);
        console.warn('    这在 Windows 上能打开，但 GitHub Pages(Linux) 会 404。');
      }
      return null;
    }
    current = path.join(current, part);
  }
  return current;
}

const server = http.createServer((req, res) => {
  let target = resolveExact(req.url === '/' ? '/index.html' : req.url);

  // 目录则补 index.html
  if (target && fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    console.warn(`  404  ${req.url}`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found: ' + req.url);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  预览地址: http://127.0.0.1:${PORT}/`);
  console.log(`  根目录:   ${ROOT}`);
  console.log('  按 Ctrl+C 停止\n');
});
