param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [Parameter(Mandatory = $true)][int]$WidthPx,
  [Parameter(Mandatory = $true)][int]$HeightPx,
  [ValidateSet('srgb', 'sgray')][string]$ColorMode = 'srgb',
  [string]$Pages = '',
  [ValidateSet('auto', 'portrait', 'landscape')][string]$Orientation = 'auto',
  [ValidateSet('contain', 'cover', 'stretch')][string]$Fit = 'contain',
  [int]$MarginPx = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$csharp = @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class PwgPixelExtractor {
    public static void ExtractToFile(Bitmap bmp, string outPath, bool grayscale) {
        int w = bmp.Width;
        int h = bmp.Height;
        Rectangle rect = new Rectangle(0, 0, w, h);
        BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
        try {
            int stride = Math.Abs(data.Stride);
            byte[] src = new byte[stride * h];
            Marshal.Copy(data.Scan0, src, 0, src.Length);
            int bpp = grayscale ? 1 : 3;
            byte[] dst = new byte[w * h * bpp];
            for (int y = 0; y < h; y++) {
                int srcRow = y * stride;
                int dstRow = y * w * bpp;
                for (int x = 0; x < w; x++) {
                    int s = srcRow + x * 3;
                    byte b = src[s];
                    byte g = src[s + 1];
                    byte r = src[s + 2];
                    if (grayscale) {
                        dst[dstRow + x] = (byte)((54 * r + 183 * g + 19 * b) >> 8);
                    } else {
                        int d = dstRow + x * 3;
                        dst[d] = r;
                        dst[d + 1] = g;
                        dst[d + 2] = b;
                    }
                }
            }
            File.WriteAllBytes(outPath, dst);
        } finally {
            bmp.UnlockBits(data);
        }
    }
}
"@

if (-not ([System.Management.Automation.PSTypeName]'PwgPixelExtractor').Type) {
  Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing
}

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

function Apply-ExifOrientation {
  param([System.Drawing.Image]$Img)
  $propId = 0x0112
  if ($Img.PropertyIdList -contains $propId) {
    $prop = $Img.GetPropertyItem($propId)
    $val = [BitConverter]::ToUInt16($prop.Value, 0)
    switch ($val) {
      2 { $Img.RotateFlip([System.Drawing.RotateFlipType]::RotateNoneFlipX) }
      3 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
      4 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipX) }
      5 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipX) }
      6 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
      7 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipX) }
      8 { $Img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
    }
    try { $Img.RemovePropertyItem($propId) } catch {}
  }
}

function Render-BitmapToCanvas {
  param(
    [System.Drawing.Image]$SourceImage,
    [string]$OutFile,
    [switch]$SkipExif
  )

  $working = $null
  $canvas = $null
  $g = $null
  try {
    $working = $SourceImage
    if (-not $SkipExif) {
      Apply-ExifOrientation -Img $working
    }

    $shouldRotate = $false
    if ($Orientation -eq 'landscape') {
      $shouldRotate = $true
    } elseif ($Orientation -eq 'auto') {
      if ($working.Width -gt $working.Height -and $WidthPx -lt $HeightPx) {
        $shouldRotate = $true
      }
    }
    if ($shouldRotate) {
      $working.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)
    }

    $canvas = New-Object System.Drawing.Bitmap($WidthPx, $HeightPx, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::White)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $innerX = [Math]::Max(0, $MarginPx)
    $innerY = [Math]::Max(0, $MarginPx)
    $innerW = [Math]::Max(1, $WidthPx - 2 * $innerX)
    $innerH = [Math]::Max(1, $HeightPx - 2 * $innerY)

    $srcW = [double]$working.Width
    $srcH = [double]$working.Height

    if ($Fit -eq 'stretch') {
      $destRect = New-Object System.Drawing.Rectangle($innerX, $innerY, $innerW, $innerH)
      $g.DrawImage($working, $destRect)
    } elseif ($Fit -eq 'cover') {
      $scale = [Math]::Max($innerW / $srcW, $innerH / $srcH)
      $drawW = $srcW * $scale
      $drawH = $srcH * $scale
      $drawX = $innerX + ($innerW - $drawW) / 2.0
      $drawY = $innerY + ($innerH - $drawH) / 2.0
      $g.SetClip((New-Object System.Drawing.Rectangle($innerX, $innerY, $innerW, $innerH)))
      $g.DrawImage($working, [float]$drawX, [float]$drawY, [float]$drawW, [float]$drawH)
      $g.ResetClip()
    } else {
      $scale = [Math]::Min($innerW / $srcW, $innerH / $srcH)
      $drawW = [int][Math]::Round($srcW * $scale)
      $drawH = [int][Math]::Round($srcH * $scale)
      $drawX = $innerX + [int][Math]::Floor(($innerW - $drawW) / 2.0)
      $drawY = $innerY + [int][Math]::Floor(($innerH - $drawH) / 2.0)
      $destRect = New-Object System.Drawing.Rectangle($drawX, $drawY, $drawW, $drawH)
      $g.DrawImage($working, $destRect)
    }

    $g.Dispose()
    $g = $null

    $isGray = ($ColorMode -eq 'sgray')
    [PwgPixelExtractor]::ExtractToFile($canvas, $OutFile, $isGray)
  } finally {
    if ($g) { $g.Dispose() }
    if ($canvas) { $canvas.Dispose() }
  }
}

$ext = [System.IO.Path]::GetExtension($resolvedInput).ToLowerInvariant()
$renderedFiles = @()
$totalPages = 1

if ($ext -eq '.pdf') {
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  $asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  })[0]

  function Await-WinRtOp {
    param($WinRtTask, [Type]$ResultType)
    $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
  }

  function Await-WinRtAction {
    param($WinRtAction)
    $netTask = $asTaskAction.Invoke($null, @($WinRtAction))
    $netTask.Wait(-1) | Out-Null
  }

  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]

  $storageFile = Await-WinRtOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedInput)) ([Windows.Storage.StorageFile])
  $pdfDoc = Await-WinRtOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storageFile)) ([Windows.Data.Pdf.PdfDocument])
  $totalPages = [int]$pdfDoc.PageCount

  $pageIndices = @()
  if ([string]::IsNullOrWhiteSpace($Pages)) {
    $pageIndices = 1..$totalPages
  } else {
    foreach ($part in ($Pages -split ',')) {
      $p = [int]$part.Trim()
      if ($p -lt 1 -or $p -gt $totalPages) {
        throw "Nomor halaman $p di luar rentang (total halaman PDF: $totalPages)"
      }
      $pageIndices += $p
    }
  }

  $innerW = [Math]::Max(1, $WidthPx - 2 * [Math]::Max(0, $MarginPx))
  $innerH = [Math]::Max(1, $HeightPx - 2 * [Math]::Max(0, $MarginPx))

  $outIdx = 0
  foreach ($pageNum in $pageIndices) {
    $outIdx++
    $pdfPage = $pdfDoc.GetPage([uint32]($pageNum - 1))
    $memStream = $null
    $netStream = $null
    $bmp = $null
    try {
      $srcW = [double]$pdfPage.Size.Width
      $srcH = [double]$pdfPage.Size.Height
      $willRotate = ($Orientation -eq 'landscape') -or ($Orientation -eq 'auto' -and $srcW -gt $srcH -and $WidthPx -lt $HeightPx)
      $boxW = if ($willRotate) { $innerH } else { $innerW }
      $boxH = if ($willRotate) { $innerW } else { $innerH }

      if ($Fit -eq 'stretch') {
        $destW = [uint32]$boxW
        $destH = [uint32]$boxH
      } elseif ($Fit -eq 'cover') {
        $scale = [Math]::Max($boxW / $srcW, $boxH / $srcH)
        $destW = [uint32][Math]::Max(1, [Math]::Round($srcW * $scale))
        $destH = [uint32][Math]::Max(1, [Math]::Round($srcH * $scale))
      } else {
        $scale = [Math]::Min($boxW / $srcW, $boxH / $srcH)
        $destW = [uint32][Math]::Max(1, [Math]::Round($srcW * $scale))
        $destH = [uint32][Math]::Max(1, [Math]::Round($srcH * $scale))
      }

      $renderOpts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $renderOpts.DestinationWidth = $destW
      $renderOpts.DestinationHeight = $destH

      $memStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      Await-WinRtAction ($pdfPage.RenderToStreamAsync($memStream, $renderOpts))
      $memStream.Seek(0)
      $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($memStream)
      $bmp = New-Object System.Drawing.Bitmap($netStream)

      $outFile = Join-Path $OutputDir ('page-{0:D4}.raw' -f $outIdx)
      Render-BitmapToCanvas -SourceImage $bmp -OutFile $outFile -SkipExif
      $renderedFiles += $outFile
    } finally {
      if ($bmp) { $bmp.Dispose() }
      if ($netStream) { $netStream.Dispose() }
      if ($memStream) { $memStream.Dispose() }
      if ($pdfPage) { $pdfPage.Dispose() }
    }
  }
} else {
  $img = $null
  try {
    $img = [System.Drawing.Image]::FromFile($resolvedInput)
    $outFile = Join-Path $OutputDir 'page-0001.raw'
    Render-BitmapToCanvas -SourceImage $img -OutFile $outFile
    $renderedFiles += $outFile
  } finally {
    if ($img) { $img.Dispose() }
  }
}

$result = [ordered]@{
  totalPages = $totalPages
  renderedPages = $renderedFiles.Count
  width = $WidthPx
  height = $HeightPx
  colorMode = $ColorMode
  files = $renderedFiles
}

$result | ConvertTo-Json -Compress
