# 浏览器端渲染回归：用 headless Edge 跑 prototype/probe.html，
# 把结果指纹（FNV-1a + 非透明像素数）与 node 路径逐项比对。
#
# 用法（在项目根）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\browser-probe.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\browser-probe.ps1 -Port 8790
#
# 退出码 0 = 全部一致；1 = 有差异（说明浏览器与 node 渲染出现分歧，或基线变了）。
# 注意：本文件必须保存为 UTF-8 with BOM，否则 Windows PowerShell 5.1 会按 ANSI 解码而乱码。

param([int]$Port = 8787)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$edge = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Error '找不到 Edge（msedge.exe）'; exit 1 }

$base = "http://127.0.0.1:$Port"
$server = $null
try {
  Invoke-WebRequest "$base/prototype/probe.html" -UseBasicParsing -TimeoutSec 2 | Out-Null
  Write-Host "复用已运行的服务器 $base"
} catch {
  $server = Start-Process node -ArgumentList @((Join-Path $root 'tools/serve.mjs'), $Port) -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 900
  Write-Host "已启动临时服务器 $base (pid $($server.Id))"
}

$tmpOut = Join-Path $env:TEMP "m0-dom-out.txt"
$tmpErr = Join-Path $env:TEMP "m0-dom-err.txt"
$prof = Join-Path $env:TEMP "edge-m0-probe"

function Invoke-Probe([string]$query) {
  Remove-Item $tmpOut, $tmpErr -ErrorAction SilentlyContinue
  $edgeArgs = @(
    '--headless=new', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom',
    "--user-data-dir=$prof", "$base/prototype/probe.html$query"
  )
  Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -NoNewWindow `
    -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr | Out-Null
  $raw = Get-Content $tmpOut -Raw
  if ($raw -match '(?s)<pre id="out">(.*?)</pre>') { return $matches[1].Trim() }
  throw "probe 没返回结果：$query"
}

function Get-PngFingerprint([string]$png) {
  $json = node -e "
import('./tools/png.mjs').then(({decodePng})=>{
  const fs=require('node:fs');
  const img=decodePng(fs.readFileSync(process.argv[1]));
  let h=0x811c9dc5;
  for (let i=0;i<img.data.length;i++){ h^=img.data[i]; h=Math.imul(h,0x01000193)>>>0; }
  let opaque=0; for(let i=3;i<img.data.length;i+=4) if(img.data[i]>0) opaque++;
  console.log(JSON.stringify({opaque,hash:h.toString(16).padStart(8,'0')}));
});
" $png
  return $json | ConvertFrom-Json
}

$cases = @(
  @{ name = 'classic+outer'; query = '?skin=../assets/default-skin.png';          png = 'prototype/m0-preview.png' }
  @{ name = 'slim';          query = '?skin=../assets/default-skin.png&slim=1';   png = 'prototype/m0-slim.png' }
  @{ name = 'test-skin';     query = '?skin=test-skin.png';                       png = 'prototype/m0-test-skin.png' }
)

$failed = 0
try {
  foreach ($c in $cases) {
    $browser = Invoke-Probe $c.query | ConvertFrom-Json
    $node = Get-PngFingerprint (Join-Path $root $c.png)
    $same = ($browser.hash -eq $node.hash) -and ($browser.opaque -eq $node.opaque)
    if (-not $same) { $failed++ }
    "{0,-14} browser {1}/{2}  node {3}/{4}  {5}" -f `
      $c.name, $browser.hash, $browser.opaque, $node.hash, $node.opaque, $(if ($same) { 'MATCH' } else { 'DIFF' })
  }
} finally {
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}

if ($failed -gt 0) { Write-Host "$failed 项不一致" -ForegroundColor Red; exit 1 }
Write-Host '全部一致'
exit 0
