# ============================================================
#  域名与线上可用性验证（PowerShell 版）
# ============================================================
#  用法：
#    powershell -File tools/check-domain.ps1
#    powershell -File tools/check-domain.ps1 -Primary www.leafer114514.xyz
#
#  Windows PowerShell 5.1 与 PowerShell 7 均可运行。
#
#  为什么是 PowerShell 而不是 Node：
#    起初这个检查写成了 Node 脚本（用 fetch），结果在本机执行时
#    对 Vercel 的所有请求都返回 ECONNRESET，而同一时刻 PowerShell
#    能正常拿到 200。也就是说那是**本地 Node 到 Vercel 的链路问题**，
#    不是站点问题 —— 但脚本据此报出了十几条"失败"，结论完全错误。
#    换成 PowerShell 的网络栈后结果与浏览器一致。
#
#  一条经验：验证工具自身也会骗人。当大量检查同时失败、
#  而对照组（如 github.io）却正常时，先怀疑工具或网络，而不是站点。
# ============================================================

param(
  [string]$Primary = 'www.leafer114514.xyz',
  [string]$Apex    = 'leafer114514.xyz',
  [string]$Waline  = 'waline.leafer114514.xyz',
  [string]$Backup  = 'leafer0.github.io'
)

$ErrorActionPreference = 'Continue'
$script:pass = 0
$script:fail = 0
$script:warn = 0

function Check($ok, $name, $detail) {
  if ($ok) { $script:pass++; Write-Host ("  OK    {0}{1}" -f $name, $(if($detail){"   $detail"}else{''})) }
  else     { $script:fail++; Write-Host ("  失败  {0}   {1}" -f $name, $detail) -ForegroundColor Red }
}
function Note($name, $detail) {
  $script:warn++; Write-Host ("  注意  {0}   {1}" -f $name, $detail) -ForegroundColor Yellow
}

# 不跟随重定向，方便把 200 与 308 分开判断
function Fetch([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 `
         -MaximumRedirection 0 -ErrorAction Stop
    return @{ ok=$true; code=[int]$r.StatusCode; len=$r.RawContentLength
              ct=$r.Headers['Content-Type']; cc=$r.Headers['Cache-Control']
              hdr=$r.Headers; body=$r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      return @{ ok=$true; code=[int]$resp.StatusCode; len=0
                ct=$resp.Headers['Content-Type']; cc=$resp.Headers['Cache-Control']
                hdr=$resp.Headers; body='' }
    }
    return @{ ok=$false; err=$_.Exception.Message }
  }
}

Write-Host ''
Write-Host '  ══ 域名与线上可用性验证 ══' -ForegroundColor Cyan
Write-Host ''
Write-Host "  正式地址: https://$Primary"
Write-Host "  评论服务: https://$Waline"
Write-Host ''

# ---------- 1. 两个入口 ----------
Write-Host '  ── 1. 两个入口 ──'
$p = Fetch "https://$Primary/"
Check ($p.ok -and $p.code -eq 200) "$Primary 返回 200" $(if($p.ok){"HTTP $($p.code)"}else{$p.err})
if ($p.ok -and $p.code -eq 200 -and $p.body) {
  $t = [regex]::Match($p.body, '<title>(.*?)</title>').Groups[1].Value
  Check ($p.body -match 'Leafer') '页面内容是本站' "标题=$t"
}
$a = Fetch "https://$Apex/"
Check ($a.ok -and ($a.code -eq 200 -or $a.code -eq 308)) "$Apex 可用" `
  $(if($a.ok){"HTTP $($a.code)"}else{$a.err})
if ($a.ok -and $a.code -ge 300 -and $a.code -lt 400) {
  Note "$Apex 会跳转" "location=$($a.hdr['Location'])"
}

# ---------- 2. 静态资源 ----------
Write-Host ''
Write-Host '  ── 2. 静态资源（换域名最容易出问题的地方）──'
$assets = @(
  '/style.css', '/data.json', '/icons.js', '/site-theme.js',
  '/vendor/waline/waline.umd.js', '/vendor/waline/waline.css',
  '/img/bg3.png.webp', '/img/Leafer.jpg.webp', '/img/case1.jpg.webp',
  '/img/Nanjing1.jpg.webp', '/admin/', '/admin/config.yml'
)
$bad = 0
foreach ($path in $assets) {
  $r = Fetch "https://$Primary$path"
  if ($r.ok -and $r.code -eq 200) {
    Write-Host ("  OK    {0,-32} {1,7} KB  {2}" -f $path, [math]::Round($r.len/1KB,1), $r.ct)
    $script:pass++
  } else {
    Write-Host ("  失败  {0,-32} {1}" -f $path, $(if($r.ok){"HTTP $($r.code)"}else{$r.err})) -ForegroundColor Red
    $bad++; $script:fail++
  }
}
Check ($bad -eq 0) "$($assets.Count) 个资源全部正常" $(if($bad){"$bad 个异常"}else{'状态码与 MIME 均正确'})

# 音频单独测：PowerShell 5.1 下载大文件常报 EOF，改用 HEAD 只取响应头
Write-Host ''
Write-Host '  ── 3. 音频文件（用 HEAD 避免大文件下载限制）──'
try {
  $h = Invoke-WebRequest -Uri "https://$Primary/music/1.mp3" -Method Head -UseBasicParsing -TimeoutSec 30
  Check ($h.StatusCode -eq 200) '/music/1.mp3 可访问' "HTTP $($h.StatusCode)  大小 $([math]::Round([int]$h.Headers['Content-Length']/1KB)) KB  $($h.Headers['Content-Type'])"
} catch {
  Check $false '/music/1.mp3 可访问' $_.Exception.Message
}

# ---------- 4. 缓存与安全响应头 ----------
Write-Host ''
Write-Host '  ── 4. 缓存策略与响应头 ──'
$ccData = (Fetch "https://$Primary/data.json").cc
$ccImg  = (Fetch "https://$Primary/img/bg3.png.webp").cc
Check ($ccData -match 'max-age=0|no-cache|no-store') 'data.json 不长期缓存' $ccData
Check ($ccImg -match 'max-age=31536000|immutable') '图片长期缓存' $ccImg

# 注意：变量名不能用 $home —— PowerShell 里 $HOME 是只读内置变量，
# 赋值会直接报错，导致这几项检查静默失效（曾因此漏报）。
$homeResp = Fetch "https://$Primary/"
foreach ($h in @('X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security')) {
  Check ([bool]$homeResp.hdr[$h]) "响应头 $h 已设置" $homeResp.hdr[$h]
}

# ---------- 5. 评论服务 ----------
Write-Host ''
Write-Host '  ── 5. 评论服务 ──'
$api = Fetch "https://$Waline/api/comment?path=/thoughts/0"
$errno = $null
if ($api.ok -and $api.body) { try { $errno = ($api.body | ConvertFrom-Json).errno } catch {} }
Check ($api.ok -and $api.code -eq 200 -and $errno -eq 0) '评论服务可访问且返回正常' `
  $(if($api.ok){"HTTP $($api.code)  errno=$errno"}else{$api.err})

$dj = Fetch "https://$Primary/data.json"
if ($dj.ok -and $dj.code -eq 200) {
  $d = $dj.body | ConvertFrom-Json
  Check ($d.comments.serverURL -eq "https://$Waline") '页面配置指向自有域名' $d.comments.serverURL
  Write-Host ("        数据完整性: 帖子 {0} / 历程 {1} / 关于我段落 {2}" -f `
    $d.articles.Count, $d.journey.Count, $d.about.paragraphs.Count)
}

# ---------- 6. 备用地址 ----------
Write-Host ''
Write-Host '  ── 6. 备用地址 ──'
$b = Fetch "https://$Backup/"
Check ($b.ok -and $b.code -eq 200) "$Backup 仍可用" $(if($b.ok){"HTTP $($b.code)"}else{$b.err})

# ---------- 汇总 ----------
Write-Host ''
if ($script:fail) {
  Write-Host ("  ══ 结果: {0} 通过, {1} 失败, {2} 注意 ══" -f $script:pass, $script:fail, $script:warn) -ForegroundColor Red
} else {
  Write-Host ("  ══ 结果: {0} 通过, 0 失败, {1} 注意 ══" -f $script:pass, $script:warn) -ForegroundColor Green
}
Write-Host ''
exit $(if($script:fail){1}else{0})
