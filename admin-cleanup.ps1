$log = 'E:\IT\alex-glad-challenge\admin-cleanup.log'
function Log($msg) { Add-Content -Path $log -Value ("{0} | {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }
Log "=== elevated cleanup started ==="

# 1. Kill watchdog and everything running from malware dirs
$targets = Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -eq 34416 -or
    $_.ExecutablePath -match 'Windows\\Caches\\(4259B89A|B283B4E1)' -or
    $_.Name -in @('RuntimeHost.exe','SecurityHealthHost.exe','peakminer.exe','bzminer.exe','srbminer.exe')
}
foreach ($p in $targets) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        Log ("killed PID {0} {1} ({2})" -f $p.ProcessId, $p.Name, $p.ExecutablePath)
    } catch {
        Log ("FAILED kill PID {0} {1}: {2}" -f $p.ProcessId, $p.Name, $_.Exception.Message)
    }
}

# 2. Remove persistence (it re-creates these)
foreach ($tn in @('Windows System Health Check')) {
    try { Unregister-ScheduledTask -TaskName $tn -Confirm:$false -ErrorAction Stop; Log "task removed: $tn" }
    catch { Log "task '$tn' not found or failed: $($_.Exception.Message)" }
}
# any other task pointing at Caches dirs
Get-ScheduledTask | ForEach-Object {
    $t = $_
    foreach ($a in $t.Actions) {
        if ($a.Execute -match 'Windows\\Caches\\(4259B89A|B283B4E1)') {
            try { Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop; Log "task removed: $($t.TaskPath)$($t.TaskName)" }
            catch { Log "FAILED task $($t.TaskName): $($_.Exception.Message)" }
        }
    }
}
foreach ($rk in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce','HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce')) {
    if (Test-Path $rk) {
        $props = Get-ItemProperty -Path $rk
        foreach ($prop in $props.PSObject.Properties) {
            if ($prop.Name -notmatch '^PS' -and ("$($prop.Value)" -match 'Caches\\(4259B89A|B283B4E1)|WinSysCache')) {
                try { Remove-ItemProperty -Path $rk -Name $prop.Name -ErrorAction Stop; Log "run key removed: $rk :: $($prop.Name)" }
                catch { Log "FAILED run key $($prop.Name): $($_.Exception.Message)" }
            }
        }
    }
}
# services
Get-CimInstance Win32_Service | Where-Object { $_.PathName -match 'Caches\\(4259B89A|B283B4E1)' } | ForEach-Object {
    try { Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue; sc.exe delete $_.Name | Out-Null; Log "service removed: $($_.Name)" }
    catch { Log "FAILED service $($_.Name): $($_.Exception.Message)" }
}
# WMI event subscriptions (common miner persistence)
try {
    $wmi = Get-WmiObject -Namespace root\subscription -Class __EventFilter -ErrorAction Stop | Where-Object { $_.Name -match 'Cache|Health|Sys' }
    foreach ($w in $wmi) { Log ("WMI filter found (review): " + $w.Name) }
} catch { Log "WMI check skipped: $($_.Exception.Message)" }

# 3. Quarantine all malware folders
$quarantine = 'E:\IT\alex-glad-challenge\quarantine-miner'
New-Item -ItemType Directory -Path $quarantine -Force | Out-Null
$dirs = @(
    "$env:APPDATA\Microsoft\Windows\Caches\4259B89A",
    "$env:APPDATA\Microsoft\Windows\Caches\B283B4E1",
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\4259B89A",
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\B283B4E1",
    'C:\ProgramData\Microsoft\Windows\Caches\4259B89A',
    'C:\ProgramData\Microsoft\Windows\Caches\B283B4E1'
)
foreach ($d in $dirs) {
    if (Test-Path $d) {
        $dest = Join-Path $quarantine ((Split-Path (Split-Path $d -Parent) -Leaf) + '-' + (Split-Path $d -Leaf) + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
        try { Move-Item -Path $d -Destination $dest -Force -ErrorAction Stop; Log "quarantined: $d -> $dest" }
        catch { Log "FAILED move ${d}: $($_.Exception.Message)" }
    } else {
        Log "absent: $d"
    }
}

# 4. Final check
Start-Sleep -Seconds 2
$left = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match 'Windows\\Caches\\(4259B89A|B283B4E1)' -or $_.ProcessId -eq 34416 }
if ($left) { foreach ($l in $left) { Log "STILL RUNNING: PID $($l.ProcessId) $($l.Name)" } }
else { Log "no malware processes running" }

Log "=== elevated cleanup finished ==="
