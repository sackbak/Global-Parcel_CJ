# index.html 통합 빌드 스크립트
# 7개 원본 HTML + Overview 합성 → 8탭 단일 페이지

$base = $PSScriptRoot
if (-not $base) { $base = 'C:\Users\User\cj-lmd-report' }

$pages = @(
  @{ id = 'korea';    file = 'cj_korea_1page.html';      label = 'Korea';    comp = $false; nameKr = '한국 (CJ대한통운)' },
  @{ id = 'overview'; file = $null;                       label = 'Overview'; comp = $false; nameKr = '비교 한판' },
  @{ id = 'vietnam';  file = 'cj_vietnam_1page_v2.html'; label = 'Vietnam';  comp = $true;  nameKr = '베트남' },
  @{ id = 'thailand'; file = 'cj_thailand_1page.html';   label = 'Thailand'; comp = $true;  nameKr = '태국' },
  @{ id = 'taiwan';   file = 'cj_taiwan_1page_v2.html';  label = 'Taiwan';   comp = $true;  nameKr = '대만' },
  @{ id = 'usa';      file = 'cj_usa_1page.html';        label = 'USA';      comp = $true;  nameKr = '미국' },
  @{ id = 'japan';    file = 'cj_japan_1page.html';      label = 'Japan';    comp = $true;  nameKr = '일본' },
  @{ id = 'china';    file = 'cj_china_1page.html';      label = 'China';    comp = $true;  nameKr = '중국' }
)

$styles = ''
$sections = ''
$tabs = ''

function Build-OverviewSection {
  param([array]$comparePages)

  $cardsHtml = ''
  foreach ($p in $comparePages) {
    $cardsHtml += @"
    <div class="overview-card" data-overview-for="$($p.id)">
      <div class="ov-title">$($p.nameKr)</div>
      <div class="ov-subtitle">$($p.label)</div>
      <svg class="overview-svg" viewBox="-115 -120 230 240">
        <polygon points="0,-90 77.94,-45 77.94,45 0,90 -77.94,45 -77.94,-45" fill="none" stroke="#ddd" stroke-width="0.5"/>
        <polygon points="0,-72 62.35,-36 62.35,36 0,72 -62.35,36 -62.35,-36" fill="none" stroke="#eee" stroke-width="0.5"/>
        <polygon points="0,-54 46.77,-27 46.77,27 0,54 -46.77,27 -46.77,-27" fill="none" stroke="#eee" stroke-width="0.5"/>
        <polygon points="0,-36 31.18,-18 31.18,18 0,36 -31.18,18 -31.18,-18" fill="none" stroke="#eee" stroke-width="0.5"/>
        <polygon points="0,-18 15.59,-9 15.59,9 0,18 -15.59,9 -15.59,-9" fill="none" stroke="#f5f5f5" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="0" y2="-90" stroke="#ccc" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="77.94" y2="-45" stroke="#ccc" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="77.94" y2="45" stroke="#ccc" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="0" y2="90" stroke="#ccc" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="-77.94" y2="45" stroke="#ccc" stroke-width="0.5"/>
        <line x1="0" y1="0" x2="-77.94" y2="-45" stroke="#ccc" stroke-width="0.5"/>
        <polygon class="ov-poly-cj" points="0,0 0,0 0,0 0,0 0,0 0,0" fill="rgba(200,156,76,0.20)" stroke="#c89c4c" stroke-width="1.5"/>
        <polygon class="ov-poly-c1" points="0,0 0,0 0,0 0,0 0,0 0,0" fill="rgba(26,58,108,0.20)" stroke="#1a3a6c" stroke-width="1.5"/>
        <polygon class="ov-poly-c2" points="0,0 0,0 0,0 0,0 0,0 0,0" fill="rgba(138,41,41,0.18)" stroke="#8a2929" stroke-width="1.5"/>
        <text x="0" y="-99" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">1.인프라</text>
        <text x="92" y="-42" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">2.자동화</text>
        <text x="92" y="55" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">3.시장재무</text>
        <text x="0" y="103" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">4.운영</text>
        <text x="-92" y="55" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">5.사업</text>
        <text x="-92" y="-42" text-anchor="middle" font-size="7" font-weight="600" fill="#1a3a6c">6.고객</text>
      </svg>
      <div class="ov-legend">
        <span><span class="ov-dot" style="background:#c89c4c"></span>CJ대한통운</span>
        <span><span class="ov-dot" style="background:#1a3a6c"></span>1위</span>
        <span><span class="ov-dot" style="background:#8a2929"></span>2위</span>
      </div>
    </div>
"@
  }

  return @"
<section data-page-content="overview">
<div class="page overview-page">
  <div class="page-num">OVERVIEW</div>
  <div class="header-band">
    <div class="brand">CJ LOGISTICS GLOBAL LMD STRATEGY REPORT</div>
    <div class="header-meta">
      <div class="title">6개국 라스트마일 역량 비교 한판</div>
      <div class="date">성장추진담당</div>
    </div>
  </div>
  <div class="section-label">6축 평균 비교 - CJ대한통운 vs 각국 1·2위 사업자</div>
  <div class="overview-grid">
$cardsHtml
  </div>
</div>
</section>
"@
}

foreach ($p in $pages) {
  $isActive = $p.id -eq 'korea'
  $tabActive = if ($isActive) { ' class="active"' } else { '' }
  $tabs += "    <button type=`"button`" data-tab=`"$($p.id)`"$tabActive>$($p.label)</button>`n"

  if ($p.id -eq 'overview') {
    $compPages = $pages | Where-Object { $_.comp }
    $sections += Build-OverviewSection -comparePages $compPages
    $sections += "`n"
    continue
  }

  $path = Join-Path $base $p.file
  if (-not (Test-Path $path)) { Write-Warning "Missing: $($p.file)"; continue }
  $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  $styleM = [regex]::Match($content, '(?s)<style>(.+?)</style>')
  if ($styleM.Success) {
    $styles += "`n/* === $($p.id) === */`n" + $styleM.Groups[1].Value.Trim() + "`n"
  }

  $bodyM = [regex]::Match($content, '(?s)<body>(.+?)</body>')
  if ($bodyM.Success) {
    $body = [regex]::Replace($bodyM.Groups[1].Value, '(?s)<script[^>]*>.*?</script>', '')
    $cls = if ($isActive) { ' class="active"' } else { '' }
    $sections += "<section data-page-content=`"$($p.id)`"$cls>`n$($body.Trim())`n</section>`n"
  }
}

$navCss = @'
body { padding-top: 56px !important; }
.tab-nav { position: fixed; top: 0; left: 0; right: 0; background: #fff; border-bottom: 1px solid #ddd; padding: 8px 16px; display: flex; gap: 4px; z-index: 1000; box-shadow: 0 1px 3px rgba(0,0,0,0.06); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif; flex-wrap: wrap; }
.tab-nav button { background: transparent; border: 1px solid transparent; color: #666; padding: 6px 14px; font-size: 12.5px; font-weight: 500; cursor: pointer; border-radius: 4px; transition: all 0.15s; font-family: inherit; }
.tab-nav button:hover { background: #f4f4ee; color: #1a3a6c; }
.tab-nav button.active { background: #1a3a6c; color: #fff; border-color: #1a3a6c; }
[data-page-content] { display: none; }
[data-page-content].active { display: block; }

/* Overview section */
.overview-page { background: white; padding: 1.5cm 1.25cm 1.2cm 1.5cm; margin: 0 auto 20px; width: 21cm; min-height: 29.7cm; box-shadow: 0 1px 4px rgba(0,0,0,0.12); position: relative; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Malgun Gothic', sans-serif; color: #222; font-size: 8.5px; line-height: 1.4; }
.overview-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; }
.overview-card { border: 1px solid #ddd; padding: 8px 6px; background: #fafaf8; text-align: center; }
.ov-title { font-size: 10px; font-weight: 600; color: #1a3a6c; }
.ov-subtitle { font-size: 7.5px; color: #888; margin-top: 1px; letter-spacing: 0.3px; }
.overview-svg { width: 100%; height: auto; max-height: 200px; display: block; margin: 4px auto 2px; }
.ov-legend { font-size: 7.5px; color: #555; display: flex; justify-content: center; gap: 8px; }
.ov-legend span { display: inline-flex; align-items: center; }
.ov-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 3px; }
'@

$html = "<!DOCTYPE html>`n<html lang=`"ko`">`n<head>`n<meta charset=`"UTF-8`">`n<meta name=`"page-id`" content=`"combined`">`n<title>CJ Global LMD</title>`n<link rel=`"stylesheet`" href=`"shared/editor.css`">`n<style>`n$styles`n$navCss`n</style>`n</head>`n<body>`n<nav class=`"tab-nav`">`n$tabs</nav>`n`n$sections`n<script src=`"shared/editor.js`"></script>`n</body>`n</html>"

$outPath = Join-Path $base 'index.html'
[System.IO.File]::WriteAllText($outPath, $html, [System.Text.UTF8Encoding]::new($false))
$size = (Get-Item $outPath).Length
Write-Host "Built index.html: $size bytes, $($pages.Count) tabs (including Overview)"
