Write-Output "=== Is watchdog PID 34416 still alive? ==="
$w = Get-Process -Id 34416 -ErrorAction SilentlyContinue
if ($w) {
    Write-Output ("STILL ALIVE: {0} PID 34416" -f $w.ProcessName)
} else {
    Write-Output "PID 34416 is gone."
}

Write-Output ""
Write-Output "=== Any new miner processes spawned? ==="
$m = Get-CimInstance Win32_Process -Filter "Name='SecurityHealthHost.exe'" -ErrorAction SilentlyContinue
if ($m) {
    $m | Select-Object ProcessId, ExecutablePath | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
} else {
    Write-Output "None."
}

Write-Output ""
Write-Output "=== Any InstallUtil.exe running? ==="
$iu = Get-CimInstance Win32_Process -Filter "Name='InstallUtil.exe'" -ErrorAction SilentlyContinue
if ($iu) {
    foreach ($p in $iu) {
        Write-Output ("PID {0} | Path: {1} | CmdLine: {2}" -f $p.ProcessId, $p.ExecutablePath, $p.CommandLine)
    }
} else {
    Write-Output "None."
}

Write-Output ""
Write-Output "=== Roaming Caches folder still there? ==="
$r = "$env:APPDATA\Microsoft\Windows\Caches\4259B89A"
if (Test-Path $r) {
    Get-ChildItem $r -Recurse -Force -ErrorAction SilentlyContinue | Select-Object FullName, Length | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
} else {
    Write-Output "Gone."
}

Write-Output ""
Write-Output "=== GPU load check ==="
$s = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 2 -ErrorAction SilentlyContinue
$hot = $s | ForEach-Object { $_.CounterSamples } | Where-Object { $_.CookedValue -gt 5 }
if ($hot) { Write-Output "STILL LOADED:"; $hot | Select-Object -First 5 InstanceName, CookedValue | Format-Table | Out-String | Write-Output }
else { Write-Output "Normal." }
