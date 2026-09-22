# Registers the "BlogAutoDrafts" Windows scheduled task.
# Daily at 07:00 it runs web/scripts/run-auto-drafts.cmd -> 2 draft posts
# land in the /blog/posts queue for manual review and sending.
# StartWhenAvailable: if the PC was off/asleep at 07:00, the run fires as
# soon as possible. First tries S4U (runs without an interactive logon,
# needs elevation); on access denied falls back to interactive-only mode.
# Re-run after changing the -At time. Remove: Unregister-ScheduledTask -TaskName BlogAutoDrafts
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$action = New-ScheduledTaskAction -Execute (Join-Path $here 'run-auto-drafts.cmd')
$trigger = New-ScheduledTaskTrigger -Daily -At 07:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

try {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U
  Register-ScheduledTask -TaskName 'BlogAutoDrafts' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
  Write-Output 'BlogAutoDrafts registered (S4U: runs without logon).'
} catch {
  Register-ScheduledTask -TaskName 'BlogAutoDrafts' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Output 'BlogAutoDrafts registered (interactive: runs while you are logged on).'
}
Get-ScheduledTask -TaskName 'BlogAutoDrafts' | Format-List TaskName, State
