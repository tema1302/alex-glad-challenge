Write-Output "=== 1. Task Scheduler operational log: tasks registered/run today 09:40-10:05 ==="
try {
    Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'; StartTime=(Get-Date '2026-10-29 09:40'); EndTime=(Get-Date '2026-10-29 10:05'); Id=106,140,141,200,201} -ErrorAction Stop |
        Select-Object TimeCreated, Id, @{n='Msg';e={$_.Message.Substring(0,[Math]::Min(180,$_.Message.Length))}} |
        Format-List | Out-String -Width 250 | Write-Output
} catch { Write-Output "no events" }

Write-Output ""
Write-Output "=== 2. Security log: logon time this morning ==="
try {
    Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4624; StartTime=(Get-Date '2026-10-29 09:00'); EndTime=(Get-Date '2026-10-29 10:00')} -MaxEvents 10 -ErrorAction Stop |
        Select-Object TimeCreated, @{n='Msg';e={$_.Message.Substring(0,[Math]::Min(120,$_.Message.Length))}} |
        Format-List | Out-String -Width 200 | Write-Output
} catch { Write-Output ("security log unavailable: " + $_.Exception.Message) }

Write-Output ""
Write-Output "=== 3. System log: boot time ==="
try {
    Get-WinEvent -FilterHashtable @{LogName='System'; Id=12} -MaxEvents 3 -ErrorAction Stop |
        Select-Object TimeCreated, Id | Format-Table -AutoSize | Out-String | Write-Output
} catch { Write-Output "n/a" }

Write-Output ""
Write-Output "=== 4. Startup folder items ==="
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Force -ErrorAction SilentlyContinue |
    Select-Object CreationTime, Name | Format-Table -AutoSize | Out-String -Width 200 | Write-Output

Write-Output ""
Write-Output "=== 5. Full hash check of quarantined watchdog ==="
$f2 = 'E:\IT\alex-glad-challenge\quarantine-miner\Caches-4259B89A-bb1d5e\RuntimeHost.exe'
if (Test-Path $f2) {
    (Get-FileHash $f2 -Algorithm SHA256).Hash | Write-Output
    (Get-Item $f2).Length | Write-Output
} else { Write-Output "RuntimeHost.exe not found in quarantine" }

Write-Output ""
Write-Output "=== 6. Any scheduled tasks/run entries created 09:50-09:56 today (XML check) ==="
Get-ChildItem 'C:\Windows\System32\Tasks' -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -ge (Get-Date '2026-10-29 09:40') -and $_.CreationTime -le (Get-Date '2026-10-29 12:30') } |
    Select-Object CreationTime, FullName | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
