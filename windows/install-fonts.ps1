$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$fontDir = Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Fonts"
$registryPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts"

New-Item -ItemType Directory -Path $fontDir -Force | Out-Null
New-Item -Path $registryPath -Force | Out-Null

$fonts = @(
  @{
    Source = Join-Path $projectRoot "fonts\arialnarrow.ttf"
    FileName = "arialnarrow.ttf"
    RegistryName = "Arial Narrow (TrueType)"
  },
  @{
    Source = Join-Path $projectRoot "fonts\sfprodisplayregular.otf"
    FileName = "sfprodisplayregular.otf"
    RegistryName = "SF Pro Display Regular (OpenType)"
  }
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FontInstaller {
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
  public static extern int AddFontResourceEx(string fileName, uint flags, IntPtr reserved);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr windowHandle,
    uint message,
    UIntPtr wordParameter,
    IntPtr longParameter,
    uint flags,
    uint timeout,
    out UIntPtr result
  );
}
"@

foreach ($font in $fonts) {
  if (-not (Test-Path -LiteralPath $font.Source)) {
    throw "File font tidak ditemukan: $($font.Source)"
  }

  $destination = Join-Path $fontDir $font.FileName
  Copy-Item -LiteralPath $font.Source -Destination $destination -Force
  New-ItemProperty `
    -Path $registryPath `
    -Name $font.RegistryName `
    -Value $destination `
    -PropertyType String `
    -Force | Out-Null
  [void][FontInstaller]::AddFontResourceEx($destination, 0, [IntPtr]::Zero)
  Write-Host "Terpasang: $($font.RegistryName)"
}

$broadcast = [IntPtr]0xffff
$fontChange = 0x001d
$result = [UIntPtr]::Zero
[void][FontInstaller]::SendMessageTimeout(
  $broadcast,
  $fontChange,
  [UIntPtr]::Zero,
  [IntPtr]::Zero,
  2,
  1000,
  [ref]$result
)

Write-Host "Font Windows siap dipakai."
