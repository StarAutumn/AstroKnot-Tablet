# ============================================================
# AstroKnot - 生成安卓启动器图标（两个移动端项目，各用各的背景）
# 前景符号: d:/AstroKnot/assets/icon.png
#   手机版(只读版): 纯白背景（自适应引用 @color/ic_launcher_background）
#   平板版: 蓝灰渐变背景（自适应引用 @drawable/ic_launcher_bg_gradient）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\generate-launcher-icons.ps1
# ============================================================
param(
  [string]$IconPath = 'd:\AstroKnot\assets\icon.png'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# 每个目标的背景定义：Bg=左上色 Bg2=右下色（Bg2 为 $null 时纯色）
$Jobs = @(
  @{ Name = '手机版(纯白)';       Res = 'd:\AstroKnot-Mobile\android\app\src\main\res';
     Bg = @(255,255,255);         Bg2 = $null },
  @{ Name = '平板版(蓝灰渐变)';   Res = 'd:\AstroKnot-Tablet\android\app\src\main\res';
     Bg = @(88,181,255);          Bg2 = @(11,69,81) }
)

function New-BgBitmap([int]$w, [int]$h, [int[]]$c1, $c2) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  if ($null -eq $c2) {
    $solid = [System.Drawing.Color]::FromArgb($c1[0], $c1[1], $c1[2])
    $brush = New-Object System.Drawing.SolidBrush($solid)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
  } else {
    $col1 = [System.Drawing.Color]::FromArgb($c1[0], $c1[1], $c1[2])
    $col2 = [System.Drawing.Color]::FromArgb($c2[0], $c2[1], $c2[2])
    # 135°: 左上 Bg → 右下 Bg2
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $col1, $col2, 135.0)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
  }
  $g.Dispose()
  return $bmp
}

function Draw-Fit([System.Drawing.Graphics]$g, [System.Drawing.Image]$img, [double]$boxW, [double]$boxH, [double]$cx, [double]$cy) {
  # 等比缩放并居中绘制到 (cx,cy) 尺寸的框内（框左上角为绘制基准）
  $scale = [math]::Min($boxW / $img.Width, $boxH / $img.Height)
  $dw = $img.Width * $scale
  $dh = $img.Height * $scale
  $dx = $cx + ($boxW - $dw) / 2
  $dy = $cy + ($boxH - $dh) / 2
  $g.DrawImage($img, [float]$dx, [float]$dy, [float]$dw, [float]$dh)
}

if (-not (Test-Path $IconPath)) { throw "源图标不存在: $IconPath" }
$src = [System.Drawing.Image]::FromFile($IconPath)
Write-Host ("源图标: {0}x{1}" -f $src.Width, $src.Height)

# 密度表：legacy 启动图标 48dp；自适应画布 108dp（图标占 62dp，处于 66dp 安全区内）
$map = @(
  @{ name = 'mdpi';    d = 1   },
  @{ name = 'hdpi';    d = 1.5 },
  @{ name = 'xhdpi';   d = 2   },
  @{ name = 'xxhdpi';  d = 3   },
  @{ name = 'xxxhdpi'; d = 4   }
)

foreach ($job in $Jobs) {
  $t = $job.Res
  if (-not (Test-Path $t)) { throw "目标 res 目录不存在: $t" }
  foreach ($m in $map) {
    $dir = Join-Path $t ('mipmap-' + $m.name)
    if (-not (Test-Path $dir)) { throw "密度目录不存在: $dir" }
    $d = $m.d

    # ---------- 1) 自适应图标前景（透明底 + 居中符号，与背景无关） ----------
    $canvas = [int](108 * $d)
    $iconSz = [int](62 * $d)
    $off    = [int](($canvas - $iconSz) / 2)

    $fg = New-Object System.Drawing.Bitmap($canvas, $canvas)
    $g = [System.Drawing.Graphics]::FromImage($fg)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    Draw-Fit $g $src $iconSz $iconSz $off $off
    $g.Dispose()
    $fg.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()

    # ---------- 2) legacy 方形图标（项目背景 + 符号 72%） ----------
    $size = [int](48 * $d)
    $ic2  = [int]($size * 0.72)
    $off2 = [int](($size - $ic2) / 2)

    $sq = New-BgBitmap $size $size $job.Bg $job.Bg2
    $g = [System.Drawing.Graphics]::FromImage($sq)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    Draw-Fit $g $src $ic2 $ic2 $off2 $off2
    $g.Dispose()
    $sq.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $sq.Dispose()

    # ---------- 3) legacy 圆形图标（圆形裁剪背景 + 符号 66%） ----------
    $ic3 = [int]($size * 0.66)
    $off3 = [int](($size - $ic3) / 2)
    $rd = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($rd)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(0, 0, $size, $size)
    $g.SetClip($path)
    $grad = New-BgBitmap $size $size $job.Bg $job.Bg2
    $g.DrawImage($grad, 0, 0, $size, $size)
    $grad.Dispose()
    Draw-Fit $g $src $ic3 $ic3 $off3 $off3
    $g.Dispose(); $path.Dispose()
    $rd.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $rd.Dispose()
  }
  Write-Host "OK $t ($($job.Name))"
}

$src.Dispose()
Write-Host '全部图标生成完成'
