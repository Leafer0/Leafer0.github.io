# ============================================================
#  域名与线上可用性验证（PowerShell 版）
# ============================================================
#  用法：
#    powershell -File tools/check-domain.ps1
#    powershell -File tools/check-domain.ps1 -Primary leafersgarden.xyz
#
#  Windows PowerShell 5.1 与 PowerShell 7 均可运行。
#
#  站点正式地址是 leafersgarden.xyz（2026-09-25 上线，含 HTTPS 与 Enforce HTTPS）。
#  旧的 leafer114514.xyz 已废弃：该域名在国内被运营商拦截，详见 README「教训」一节。
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
  [string]$Primary = 'leafersgarden.xyz',
  [string]$Apex    = 'leafersgarden.xyz',
  [string]$Waline  = 'waline.leafersgarden.xyz',
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
#
# 注意这里对响应头的读取必须"容错"：
# PowerShell 5.1 的 WebResponse 对**不存在的响应头**做索引会抛
# "Operation is not valid due to the current state of the object"，
# 而不是安静地返回 $null。301/308 响应往往没有 Cache-Control，
# 于是取它就炸 —— 曾因此让「备用地址」这项检查报出莫名其妙的失败。
# 所以统一用 Get-Hdr 取值，任何异常都降级为 $null。
function Get-Hdr($headers, [string]$name) {
  if (-not $headers) { return $null }
  try {
    $v = $headers[$name]
    if ($v -is [array]) { return ($v -join ', ') }
    return $v
  } catch { return $null }
}

# Fetch：默认**跟随重定向**，返回最终状态。
#
# 为什么不自己判断重定向：
#   PowerShell 5.1 在 -MaximumRedirection 0 遇到 301/302/308 时，
#   抛出的 InvalidOperationException **不携带 Response 对象**
#   （消息是"对象的当前状态使该操作无效"），于是读不到状态码，
#   只能当成失败。而 leafer0.github.io 现在正是 301 跳转到新域名，
#   于是那项检查永远报失败 —— 是脚本的问题，不是站点的问题。
#   改为跟随跳转、判断最终是否 200，才反映访客的真实体验。
function Fetch([string]$url) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30 `
         -MaximumRedirection 5 -ErrorAction Stop
    return @{ ok=$true; code=[int]$r.StatusCode; len=$r.RawContentLength
              ct=(Get-Hdr $r.Headers 'Content-Type')
              cc=(Get-Hdr $r.Headers 'Cache-Control')
              hdr=$r.Headers; body=$r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      return @{ ok=$true; code=[int]$resp.StatusCode; len=0
                ct=(Get-Hdr $resp.Headers 'Content-Type')
                cc=(Get-Hdr $resp.Headers 'Cache-Control')
                hdr=$resp.Headers; body='' }
    }
    return @{ ok=$false; err=$_.Exception.Message }
  }
}

# 只看"不跟随重定向时的状态码与目标"，用于验证 Enforce HTTPS 是否生效。
# 用 .NET 的 HttpWebRequest 而不是 Invoke-WebRequest，
# 因为后者在 MaximumRedirection 0 下拿不到重定向响应（见上面的说明）。
function Get-RedirectTarget([string]$url) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.AllowAutoRedirect = $false
    $req.Timeout = 20000
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $loc = $resp.Headers['Location']
    $resp.Close()
    return @{ code=$code; loc=$loc }
  } catch [System.Net.WebException] {
    $r = $_.Exception.Response
    if ($r) {
      $code = [int]$r.StatusCode
      $loc = $r.Headers['Location']
      $r.Close()
      return @{ code=$code; loc=$loc }
    }
    return @{ code=0; loc=$null }
  } catch {
    return @{ code=0; loc=$null }
  }
}

Write-Host ''
Write-Host '  ══ 域名与线上可用性验证 ══' -ForegroundColor Cyan
Write-Host ''
Write-Host "  正式地址: https://$Primary"
Write-Host "  评论服务: https://$Waline"
Write-Host ''

# ---------- 1. 入口与 HTTPS 强制跳转 ----------
Write-Host '  ── 1. 入口 ──'
$p = Fetch "https://$Primary/"
Check ($p.ok -and $p.code -eq 200) "$Primary 返回 200" $(if($p.ok){"HTTP $($p.code)"}else{$p.err})
if ($p.ok -and $p.code -eq 200 -and $p.body) {
  $t = [regex]::Match($p.body, '<title>(.*?)</title>').Groups[1].Value
  Check ($p.body -match 'Leafer') '页面内容是本站' "标题=$t"
}

# Enforce HTTPS：HTTP 应当 301 到 HTTPS。这项是真实且重要的（否则访客可能一直走明文）
$redir = Get-RedirectTarget "http://$Primary/"
Check ($redir.code -eq 301 -and $redir.loc -like 'https://*') `
  'HTTP 会强制跳转到 HTTPS（Enforce HTTPS 已生效）' "HTTP $($redir.code) -> $($redir.loc)"

# 备用地址：GitHub Pages 的旧地址仍在，且会跳到正式域名
$b = Fetch "https://$Backup/"
Check ($b.ok -and $b.code -eq 200) "$Backup 仍可用" `
  $(if($b.ok){"HTTP $($b.code)（跟随跳转后）"}else{$b.err})

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
# 注意：本站目前托管在 GitHub Pages 上，而 **GitHub Pages 不支持自定义响应头**。
# vercel.json 里那份缓存策略只在 Vercel 上生效。
# 所以这里只做"信息展示"，不判成败 —— 否则会得出"缓存没配好"的错误结论。
# 如果将来迁回 Vercel，把下面两行改成 Check 判定即可。
Write-Host ''
Write-Host '  ── 4. 缓存与响应头（GitHub Pages 不支持自定义，仅供参考）──'
$ccData = (Fetch "https://$Primary/data.json").cc
$ccImg  = (Fetch "https://$Primary/img/bg3.png.webp").cc
Write-Host "    data.json 的 Cache-Control : $(if($ccData){$ccData}else{'(未设置)'})"
Write-Host "    图片的 Cache-Control       : $(if($ccImg){$ccImg}else{'(未设置)'})"

# 注意：变量名不能用 $home —— PowerShell 里 $HOME 是只读内置变量，
# 赋值会直接报错，导致这几项检查静默失效（曾因此漏报）。
$homeResp = Fetch "https://$Primary/"
foreach ($h in @('X-Content-Type-Options', 'Referrer-Policy', 'Strict-Transport-Security')) {
  Write-Host "    $h : $(if($homeResp.hdr[$h]){$homeResp.hdr[$h]}else{'(未设置)'})"
}
# HSTS 必须由 GitHub Pages 自己设置，这项是真实且重要的
Check ([bool]$homeResp.hdr['Strict-Transport-Security']) `
  'HSTS 已启用（浏览器会强制用 HTTPS）' $homeResp.hdr['Strict-Transport-Security']

# ---------- 5. 评论服务 ----------
# 评论区是按需启用的：data.json 里 comments.serverURL 为空时整站不显示评论区，
# 这是刻意设计（服务不可用时不给读者留一个坏掉的框子）。
# 所以"未启用"不算失败，只在启用后才校验连通性。
Write-Host ''
Write-Host '  ── 5. 评论服务 ──'
$dj = Fetch "https://$Primary/data.json"
if ($dj.ok -and $dj.code -eq 200) {
  $d = $dj.body | ConvertFrom-Json
  $configured = [string]$d.comments.serverURL
  Write-Host ("        数据完整性: 帖子 {0} / 历程 {1} / 关于我段落 {2}" -f `
    $d.articles.Count, $d.journey.Count, $d.about.paragraphs.Count)

  if (-not $configured) {
    Write-Host '    未启用（comments.serverURL 为空，评论区整块隐藏）' -ForegroundColor Yellow
  } else {
    Write-Host "        配置的服务地址: $configured"
    $api = Fetch "$configured/api/comment?path=/thoughts/0"
    $errno = $null
    if ($api.ok -and $api.body) { try { $errno = ($api.body | ConvertFrom-Json).errno } catch {} }
    Check ($api.ok -and $api.code -eq 200 -and $errno -eq 0) '评论服务可访问且返回正常' `
      $(if($api.ok){"HTTP $($api.code)  errno=$errno"}else{$api.err})
  }
}

# ---------- 汇总 ----------
Write-Host ''
if ($script:fail) {
  Write-Host ("  ══ 结果: {0} 通过, {1} 失败, {2} 注意 ══" -f $script:pass, $script:fail, $script:warn) -ForegroundColor Red
} else {
  Write-Host ("  ══ 结果: {0} 通过, 0 失败, {1} 注意 ══" -f $script:pass, $script:warn) -ForegroundColor Green
}
Write-Host ''
exit $(if($script:fail){1}else{0})
