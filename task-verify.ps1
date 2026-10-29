$bad = Get-ScheduledTask | Where-Object {
    $t = $_
    ($t.TaskName -match 'Health Check|SysCache') -or
    ($t.Actions | Where-Object { $_.Execute -match 'Caches\\4259B89A|Caches\\B283B4E1|RuntimeHost' })
}
if ($bad) { $bad | Select-Object TaskName, TaskPath, State | Format-Table -AutoSize | Out-String | Write-Output }
else { Write-Output "No suspicious scheduled tasks." }
