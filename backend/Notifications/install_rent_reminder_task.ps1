$ErrorActionPreference = 'Stop'

$phpExe = 'C:\xampp\php\php.exe'
$scriptPath = Join-Path $PSScriptRoot 'send_rent_reminders.php'
$taskName = 'MylesBoardingHouseRentSmsReminders'
$timeZone = Get-TimeZone

if (-not (Test-Path $phpExe)) {
    throw "PHP CLI was not found at $phpExe."
}
if ($timeZone.BaseUtcOffset -ne [TimeSpan]::FromHours(8)) {
    throw "Windows must use a UTC+08:00 timezone for the 9:00 AM Philippine-time schedule. Current timezone: $($timeZone.DisplayName)."
}

$action = New-ScheduledTaskAction `
    -Execute $phpExe `
    -Argument ('"{0}"' -f $scriptPath) `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '9:00AM'
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description 'Sends one daily TextBee SMS reminder for each active tenant payment due within three days or overdue.' `
    -Force | Out-Null

Write-Host "Installed '$taskName' to run daily at 9:00 AM Philippine time."
Write-Host 'The task runs only while the installing Windows user is signed in.'
