# ============================================================
#  核对 leafersgarden.xyz 的 DNS 记录是否满足 GitHub Pages 要求
# ============================================================
#  用法：powershell -ExecutionPolicy Bypass -File tools/check-dns-records.ps1
#
#  背景：GitHub Pages 的 Settings → Pages 一直显示 "DNS check is in progress"。
#  最常见的原因是记录不齐 —— GitHub 对记录完整性比"能解析"更敏感，
#  只加一条 A 记录时经常一直卡在检查中。
#
#  注意不要用 `nslookup -type=$var` 这种写法：
#  Windows PowerShell 5.1 下变量插值在部分位置会失效，
#  结果被当成字面量 `$var` 传给 nslookup，报 "unknown query type"，
#  从而给出"没有记录"的假象。这里逐条写死类型名。
# ============================================================

param([string]$Domain = 'leafersgarden.xyz')

$ErrorActionPreference = 'Continue'

function Get-Records([string]$name, [string]$type, [string]$server = '8.8.8.8') {
  $out = & nslookup "-type=$type" $name $server 2>&1 | Out-String
  if ($out -match 'Non-existent|can\.t find') { return @() }
  $vals = @()
  foreach ($line in ($out -split "`r?`n")) {
    if ($line -match '^\s*(Addresses|Address)\s*:\s*(.+)$') {
      $v = $Matches[2].Trim()
      # 排除 DNS 服务器自身地址（nslookup 会把它也打印出来）
      if ($v -ne $server -and $v -ne 'UnKnown') { $vals += $v }
    }
    if ($line -match 'canonical name\s*=\s*(.+)$') { $vals += $Matches[1].Trim() }
    if ($line -match 'text\s*=\s*(.+)$') { $vals += $Matches[1].Trim() }
  }
  return ($vals | Select-Object -Unique)
}

$expectedA = @('185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153')
$expectedAAAA = @('2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153')

Write-Host ''
Write-Host "  ══ $Domain DNS 记录核对 ══" -ForegroundColor Cyan
Write-Host ''

# ---- A 记录 ----
Write-Host '  ── A 记录（GitHub 要求，推荐 4 条全加）──'
$haveA = Get-Records $Domain 'A'
foreach ($ip in $expectedA) {
  $ok = $haveA -contains $ip
  $mark = if ($ok) { 'OK  ' } else { '缺失' }
  $color = if ($ok) { 'Gray' } else { 'Red' }
  Write-Host ("    {0}  {1}" -f $mark, $ip) -ForegroundColor $color
}
if ($haveA | Where-Object { $_ -notin $expectedA }) {
  Write-Host ('    额外记录: ' + (($haveA | Where-Object { $_ -notin $expectedA }) -join ', ')) -ForegroundColor Yellow
}

# ---- www 子域 ----
Write-Host ''
Write-Host '  ── www 子域（GitHub 建议配置，对 HTTPS 更友好）──'
$wwwA = Get-Records "www.$Domain" 'A'
$wwwC = Get-Records "www.$Domain" 'CNAME'
if ($wwwC.Count) { Write-Host "    OK    CNAME -> $($wwwC -join ', ')" }
elseif ($wwwA.Count) { Write-Host "    OK    A -> $($wwwA -join ', ')" }
else { Write-Host '    缺失  未配置（若检查卡住，建议加上 CNAME -> <用户名>.github.io）' -ForegroundColor Yellow }

# ---- TXT 验证 ----
Write-Host ''
Write-Host '  ── 域名所有权验证 TXT ──'
$challenge = "_github-pages-challenge-$($Domain.Split('.')[0])"
$txt = Get-Records "$challenge.$Domain" 'TXT'
# GitHub 的用户名是 Leafer0，主机记录里通常小写
if (-not $txt.Count) { $txt = Get-Records "_github-pages-challenge-leafer0.$Domain" 'TXT' }
if ($txt.Count) {
  $v = $txt[0]
  Write-Host "    OK    已发布，长度 $($v.Length) 字符"
} else {
  Write-Host '    缺失  未找到 _github-pages-challenge-* 记录' -ForegroundColor Red
}

# ---- 冲突检查 ----
Write-Host ''
Write-Host '  ── 冲突检查 ──'
$apexCname = Get-Records $Domain 'CNAME'
if ($apexCname.Count) {
  Write-Host "    ⚠ 裸域存在 CNAME（$($apexCname -join ', ')）—— 会与 A 记录冲突，必须删除" -ForegroundColor Red
} else {
  Write-Host '    OK    裸域无 CNAME（正确，裸域只能用 A/AAAA）'
}

# ---- 结论 ----
Write-Host ''
$missingA = $expectedA | Where-Object { $haveA -notcontains $_ }
if ($missingA.Count) {
  Write-Host "  ══ 结论：缺少 $($missingA.Count) 条 A 记录，建议补齐后重试 ══" -ForegroundColor Yellow
  Write-Host "     缺失: $($missingA -join ', ')"
} else {
  Write-Host '  ══ 结论：A 记录已齐全 ══' -ForegroundColor Green
}
Write-Host ''
