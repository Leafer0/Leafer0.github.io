# ============================================================
#  验证评论的"提交"链路（POST）
# ============================================================
#  用法：powershell -ExecutionPolicy Bypass -File tools/test-comment-submit.ps1
#
#  为什么单独测 POST：
#    其它脚本只验证了"读"（GET /api/comment 取评论列表）。
#    而"不能评论"属于**写**的问题 —— 两者方法不同、响应头不同，
#    读得通不代表写得进去。
#
#  为什么用 PowerShell 而不是 Node：
#    本机 Node 对 Vercel 的请求会被链路层重置（ECONNRESET / fetch failed），
#    而同一时刻 PowerShell 能正常通信。用 Node 测会得到"提交失败"的
#    错误结论 —— 这个坑之前踩过。
#
#  注意：这会真的创建一条带标记的评论，方便你在后台找到并删除。
# ============================================================

param(
  [string]$Base = 'https://waline.leafersgarden.xyz',
  [string]$Path = '/guestbook'
)

$ErrorActionPreference = 'Continue'
$Base = $Base.TrimEnd('/')
$origin = 'https://leafersgarden.xyz'

Write-Host ''
Write-Host '  ── 评论提交链路测试 ──' -ForegroundColor Cyan
Write-Host "  服务: $Base"
Write-Host "  path: $Path"
Write-Host ''

# ---------- 1. CORS 预检 ----------
Write-Host '  1) CORS 预检 (OPTIONS)'
try {
  $r = Invoke-WebRequest -Uri "$Base/api/comment" -Method Options -UseBasicParsing -TimeoutSec 30 `
       -Headers @{
         Origin = $origin
         'Access-Control-Request-Method' = 'POST'
         'Access-Control-Request-Headers' = 'content-type'
       } -ErrorAction Stop
  Write-Host ("     HTTP {0}  allow-origin={1}  allow-methods={2}" -f `
    [int]$r.StatusCode, $r.Headers['Access-Control-Allow-Origin'], $r.Headers['Access-Control-Allow-Methods'])
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    Write-Host ("     HTTP {0}  allow-origin={1}" -f [int]$resp.StatusCode, $resp.Headers['Access-Control-Allow-Origin'])
  } else {
    Write-Host ("     失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

# ---------- 2. 实际提交 ----------
$marker = '自动测试-' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Write-Host ''
Write-Host '  2) 提交一条评论 (POST)'
$body = @{
  comment = "$marker（可删除）"
  nick    = '链路自检'
  mail    = ''
  link    = ''
  ua      = 'dsh-check'
  url     = $Path
} | ConvertTo-Json -Compress
$submitted = $false
try {
  $r = Invoke-WebRequest -Uri "$Base/api/comment" -Method Post -UseBasicParsing -TimeoutSec 40 `
       -ContentType 'application/json' `
       -Headers @{ Origin = $origin } `
       -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop
  Write-Host ("     HTTP {0}" -f [int]$r.StatusCode)
  Write-Host ("     响应: {0}" -f $r.Content.Substring(0, [Math]::Min(220, $r.Content.Length)))
  $submitted = $true
} catch {
  $resp = $_.Exception.Response
  if ($resp) {
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $txt = $reader.ReadToEnd()
    Write-Host ("     HTTP {0}" -f [int]$resp.StatusCode) -ForegroundColor Yellow
    Write-Host ("     响应: {0}" -f $txt.Substring(0, [Math]::Min(220, $txt.Length)))
  } else {
    Write-Host ("     提交失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

# ---------- 3. 读回来确认 ----------
Write-Host ''
Write-Host '  3) 重新读取，确认刚才那条是否已存在'
try {
  $u = "$Base/api/comment?path=" + [uri]::EscapeDataString($Path) + "&pageSize=50&sortBy=insertedAt_desc"
  $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
  $j = $r.Content | ConvertFrom-Json
  $found = $null
  foreach ($c in $j.data.data) {
    if ($c.comment -like "*$marker*") { $found = $c; break }
  }
  if ($found) {
    Write-Host ("     OK    已写入并读回，当前评论条数 = {0}" -f $j.data.count) -ForegroundColor Green
    Write-Host ("     清理：登录 $Base/ui 删除内容含「$marker」的评论")
  } else {
    Write-Host '     注意  未读回。若服务端开了评论审核（COMMENT_AUDIT），' -ForegroundColor Yellow
    Write-Host ("           新评论需在 $Base/ui 审核后才显示。")
    Write-Host ("           当前读到的评论条数 = {0}" -f $j.data.count)
  }
} catch {
  Write-Host ("     读取失败: {0}" -f $_.Exception.Message) -ForegroundColor Red
}
Write-Host ''
