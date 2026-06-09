Add-Type -AssemblyName System.Drawing

$W = 1200
$H = 630
$logoPath = "d:\PROJECTS_LOCAL\BlazorMermaidEditor\src\wwwroot\_bortronx_logo.png"
$outPath  = "d:\PROJECTS_LOCAL\BlazorMermaidEditor\src\wwwroot\social-preview.png"

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# --- Background: diagonal dark gradient (navy) ---
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$c1 = [System.Drawing.Color]::FromArgb(255, 18, 49, 58)   # teal-ish dark top-left
$c2 = [System.Drawing.Color]::FromArgb(255, 7, 11, 20)    # near-black bottom-right
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 35.0)
$g.FillRectangle($grad, $rect)

# --- Subtle teal glow circle (upper-center) ---
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(300, -150, 600, 600)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(60, 20, 184, 166)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 20, 184, 166))
$g.FillPath($pgb, $glowPath)

# --- Teal accent bottom border ---
$accent = [System.Drawing.Color]::FromArgb(255, 20, 184, 166)
$accentBrush = New-Object System.Drawing.SolidBrush $accent
$g.FillRectangle($accentBrush, 0, ($H - 8), $W, 8)

# --- Logo (white, centered horizontally, upper area) ---
$logo = [System.Drawing.Image]::FromFile($logoPath)
$logoSize = 150
$logoX = [int](($W - $logoSize) / 2)
$logoY = 70
$g.DrawImage($logo, $logoX, $logoY, $logoSize, $logoSize)

# --- Text setup ---
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center

$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 226, 232, 240))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
$accentTextBrush = New-Object System.Drawing.SolidBrush $accent

$family = "Segoe UI"

# Title: "Bortronx" (accent) + " Mermaid Editor" (white) — measure to center as one line
$titleFont = New-Object System.Drawing.Font($family, 50, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$part1 = "Bortronx "
$part2 = "Mermaid Editor"
$w1 = $g.MeasureString($part1, $titleFont)
$w2 = $g.MeasureString($part2, $titleFont)
$totalW = $w1.Width + $w2.Width
$titleY = 250
$startX = ($W - $totalW) / 2
$leftSF = New-Object System.Drawing.StringFormat
$leftSF.Alignment = [System.Drawing.StringAlignment]::Near
$leftSF.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString($part1, $titleFont, $accentTextBrush, $startX, $titleY, $leftSF)
$g.DrawString($part2, $titleFont, $white, ($startX + $w1.Width), $titleY, $leftSF)

# Subtitle
$subFont = New-Object System.Drawing.Font($family, 26, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString("Free online Mermaid diagram editor with live preview", $subFont, $muted, ($W/2), 335, $sf)

# Feature pill
$pillFont = New-Object System.Drawing.Font($family, 22, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$pillText = "Live Preview  -  Data Flow Mode  -  Dark Mode"
$pillTextSize = $g.MeasureString($pillText, $pillFont)
$pillPadX = 28
$pillH = 50
$pillW = $pillTextSize.Width + ($pillPadX * 2)
$pillX = ($W - $pillW) / 2
$pillY = 410
$pillRect = New-Object System.Drawing.Rectangle ([int]$pillX), ([int]$pillY), ([int]$pillW), ([int]$pillH)
# rounded rect
$pillPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = $pillH / 2
$pillPath.AddArc($pillRect.X, $pillRect.Y, $r*2, $r*2, 90, 180)
$pillPath.AddArc(($pillRect.Right - $r*2), $pillRect.Y, $r*2, $r*2, 270, 180)
$pillPath.CloseFigure()
$g.FillPath($accentBrush, $pillPath)
$pillTextBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 7, 11, 20))
$g.DrawString($pillText, $pillFont, $pillTextBrush, ($W/2), ($pillY + $pillH/2), $sf)

# --- Save ---
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose(); $logo.Dispose()
Write-Host "Saved social-preview.png ($W x $H)"
