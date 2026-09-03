param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("install", "start", "stop", "status", "uninstall")]
  [string]$Action
)

$ErrorActionPreference = "Stop"
$taskName = "BotWhatsAppASY"
$runnerPath = Join-Path $PSScriptRoot "run-bot.ps1"
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Get-BotTask {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

switch ($Action) {
  "install" {
    $powershellPath = Join-Path $PSHOME "powershell.exe"
    $taskAction = New-ScheduledTaskAction `
      -Execute $powershellPath `
      -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal `
      -UserId $userId `
      -LogonType Interactive `
      -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew `
      -RestartCount 10 `
      -RestartInterval (New-TimeSpan -Minutes 1) `
      -StartWhenAvailable

    Register-ScheduledTask `
      -TaskName $taskName `
      -Action $taskAction `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Description "Menjalankan Bot WhatsApp ASY saat user Windows login." `
      -Force | Out-Null

    Write-Host "Auto-start terpasang. Jalankan aksi 'start' untuk menyalakan bot sekarang."
  }
  "start" {
    if (-not (Get-BotTask)) {
      throw "Task belum terpasang. Jalankan aksi 'install' terlebih dahulu."
    }
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Bot dinyalakan."
  }
  "stop" {
    if (-not (Get-BotTask)) {
      throw "Task belum terpasang."
    }
    Stop-ScheduledTask -TaskName $taskName
    Write-Host "Bot dimatikan."
  }
  "status" {
    $task = Get-BotTask
    if (-not $task) {
      Write-Host "Auto-start belum terpasang."
      exit 0
    }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    Write-Host "Status: $($task.State)"
    Write-Host "Terakhir jalan: $($info.LastRunTime)"
    Write-Host "Hasil terakhir: $($info.LastTaskResult)"
  }
  "uninstall" {
    if (Get-BotTask) {
      Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    Write-Host "Auto-start dihapus."
  }
}
