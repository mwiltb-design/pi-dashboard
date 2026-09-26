Add-Type -AssemblyName System.Drawing

function Draw-FociLogo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $scale = $size / 64.0

    # Draw rounded rect: x=0, y=0, w=64, h=64, rx=16
    $radius = 16.0 * $scale
    $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rect.X, $rect.Y, $radius * 2, $radius * 2, 180, 90)
    $path.AddArc($rect.Right - $radius * 2, $rect.Y, $radius * 2, $radius * 2, 270, 90)
    $path.AddArc($rect.Right - $radius * 2, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $radius * 2, $radius * 2, $radius * 2, 90, 90)
    $path.CloseFigure()

    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#102a2d"))
    $g.FillPath($bgBrush, $path)
    $bgBrush.Dispose()
    $path.Dispose()

    # Draw Ellipse: cx=32, cy=32, rx=21, ry=13 -> x = 32-21=11, y = 32-13=19, w = 42, h = 26
    $strokeWidth = [Math]::Max(1.0, 3.5 * $scale)
    $pen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#71d5c3"), $strokeWidth)
    $g.DrawEllipse($pen, (11.0 * $scale), (19.0 * $scale), (42.0 * $scale), (26.0 * $scale))
    $pen.Dispose()

    # Draw 2 circles: cx=22, cy=32, r=4.5 -> x = 17.5, y = 27.5, d = 9
    # cx=42, cy=32, r=4.5 -> x = 37.5, y = 27.5, d = 9
    $fociBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#7cc8ed"))
    $d = 9.0 * $scale
    $y = 27.5 * $scale
    $g.FillEllipse($fociBrush, (17.5 * $scale), $y, $d, $d)
    $g.FillEllipse($fociBrush, (37.5 * $scale), $y, $d, $d)
    $fociBrush.Dispose()

    $g.Dispose()
    return $bmp
}

$assetsDir = Join-Path (Split-Path -Parent $PSScriptRoot) "assets"
if (-not (Test-Path $assetsDir)) { New-Item -ItemType Directory -Path $assetsDir | Out-Null }

# Generate 256x256 PNG
$pngBmp = Draw-FociLogo 256
$pngPath = Join-Path $assetsDir "icon.png"
$pngBmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBmp.Dispose()
Write-Host "Generated $pngPath" -ForegroundColor Green

# Generate multi-size ICO: 16, 32, 48, 64, 128, 256
$sizes = @(16, 32, 48, 64, 128, 256)
$pngBytesList = @()

foreach ($s in $sizes) {
    $bmp = Draw-FociLogo $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += ,@($s, $ms.ToArray())
    $bmp.Dispose()
    $ms.Dispose()
}

$icoPath = Join-Path $assetsDir "icon.ico"
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICO Header
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type 1 = ICO
$bw.Write([uint16]$sizes.Count) # Image count

$headerSize = 6 + ($sizes.Count * 16)
$currentOffset = $headerSize

# Directory entries
foreach ($entry in $pngBytesList) {
    $s = $entry[0]
    $data = $entry[1]
    $w = if ($s -ge 256) { 0 } else { [byte]$s }
    $h = if ($s -ge 256) { 0 } else { [byte]$s }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0) # Palette colors
    $bw.Write([byte]0) # Reserved
    $bw.Write([uint16]1) # Color planes
    $bw.Write([uint16]32) # Bits per pixel
    $bw.Write([uint32]$data.Length)
    $bw.Write([uint32]$currentOffset)
    $currentOffset += $data.Length
}

# Image data
foreach ($entry in $pngBytesList) {
    $data = $entry[1]
    $bw.Write($data)
}

$bw.Close()
$fs.Close()
Write-Host "Generated $icoPath" -ForegroundColor Green
