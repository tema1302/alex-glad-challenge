$ErrorActionPreference = 'Continue'

Write-Output "=== Step 0: identify watchdog PID 34416 ==="
$watchdog = Get-CimInstance Win32_Process -Filter "ProcessId=34416" -ErrorAction SilentlyContinue
if ($watchdog) {
    Write-Output ("PID 34416: {0} | {1}" -f $watchdog.Name, $watchdog.ExecutablePath)
    Write-Output ("CmdLine: {0}" -f $watchdog.CommandLine)
} else {
    Write-Output "PID 34416 not found (already exited?)"
}

Write-Output ""
Write-Output "=== Step 1: remove scheduled task 'Windows System Health Check' ==="
try {
    Unregister-ScheduledTask -TaskName 'Windows System Health Check' -Confirm:$false -ErrorAction Stop
    Write-Output "Task removed."
} catch {
    Write-Output ("Task removal failed: " + $_.Exception.Message)
}

Write-Output ""
Write-Output "=== Step 2: remove Run key 'WinSysCache' ==="
try {
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'WinSysCache' -ErrorAction Stop
    Write-Output "Run key removed."
} catch {
    Write-Output ("Run key removal failed: " + $_.Exception.Message)
}

Write-Output ""
Write-Output "=== Step 3: kill watchdog and all miner processes ==="
$minerProcs = Get-CimInstance Win32_Process -Filter "Name='SecurityHealthHost.exe'" -ErrorAction SilentlyContinue
$minerCount = 0
foreach ($p in $minerProcs) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        $minerCount++
    } catch {}
}
Write-Output ("Killed {0} miner processes." -f $minerCount)

# kill watchdog by path match too (RuntimeHost.exe in user Caches dir)
$wdProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -match 'AppData\\(Roaming|Local)\\Microsoft\\Windows\\Caches\\' -and $_.Name -in @('RuntimeHost.exe','SecurityHealthHost.exe')
}
foreach ($p in $wdProcs) {
    try {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
        Write-Output ("Killed watchdog PID {0} ({1})" -f $p.ProcessId, $p.ExecutablePath)
    } catch {
        Write-Output ("Failed to kill PID {0}: {1}" -f $p.ProcessId, $_.Exception.Message)
    }
}
if ($watchdog) {
    try { Stop-Process -Id 34416 -Force -ErrorAction Stop; Write-Output "Killed PID 34416." } catch { Write-Output ("PID 34416: " + $_.Exception.Message) }
}

Write-Output ""
Write-Output "=== Step 4: quarantine miner folders ==="
$quarantine = "E:\IT\alex-glad-challenge\quarantine-miner"
New-Item -ItemType Directory -Path $quarantine -Force | Out-Null
$targets = @(
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\B283B4E1",
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\4259B89A",
    "$env:APPDATA\Microsoft\Windows\Caches\4259B89A",
    "$env:APPDATA\Microsoft\Windows\Caches\B283B4E1"
)
foreach ($t in $targets) {
    if (Test-Path $t) {
        $dest = Join-Path $quarantine ((Split-Path $t -Parent | Split-Path -Leaf) + '-' + (Split-Path $t -Leaf) + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
        try {
            Move-Item -Path $t -Destination $dest -Force -ErrorAction Stop
            Write-Output ("Quarantined: {0} -> {1}" -f $t, $dest)
        } catch {
            Write-Output ("Failed to move {0}: {1}" -f $t, $_.Exception.Message)
        }
    }
}

Write-Output ""
Write-Output "=== Step 5: verify nothing left running ==="
Start-Sleep -Seconds 3
$left = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ExecutablePath -match 'srbminer|AppData\\(Roaming|Local)\\Microsoft\\Windows\\Caches'
}
if ($left) {
    $left | Select-Object ProcessId, Name, ExecutablePath | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
} else {
    Write-Output "No miner/watchdog processes remain."
}

Write-Output ""
Write-Output "=== Step 6: check GPU load now ==="
$s = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 2 -ErrorAction SilentlyContinue
$hot = $s | ForEach-Object { $_.CounterSamples } | Where-Object { $_.CookedValue -gt 5 }
if ($hot) {
    $hot | Sort-Object CookedValue -Descending | Select-Object -First 5 InstanceName, @{n='Util%';e={[math]::Round($_.CookedValue,1)}} | Format-Table -AutoSize | Out-String -Width 150 | Write-Output
} else {
    Write-Output "GPU load is back to normal (no engines above 5%)."
}
