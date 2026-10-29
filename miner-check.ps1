# Ежедневная проверка: лог в %TEMP% с ротацией, в repo ничего не пишем.
$logPath = Join-Path $env:TEMP 'miner-check.log'
try {
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 1MB)) {
        Move-Item -LiteralPath $logPath -Destination ($logPath + '.1') -Force
    }
    Start-Transcript -Path $logPath -Append -Force | Out-Null
} catch { }

Write-Output "=== Contents of miner folders ==="
$dirs = @(
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\B283B4E1\srbminer",
    "$env:LOCALAPPDATA\Microsoft\Windows\Caches\4259B89A\Content.IE5\CBADF215"
)
foreach ($d in $dirs) {
    if (Test-Path $d) {
        Write-Output "--- $d ---"
        Get-ChildItem -Path $d -Recurse -Force -ErrorAction SilentlyContinue |
            Select-Object FullName, Length, CreationTime, LastWriteTime |
            Format-Table -AutoSize | Out-String -Width 200 | Write-Output
    }
}

Write-Output ""
Write-Output "=== Scheduled tasks (non-Microsoft, pointing to user folders) ==="
Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
    $task = $_
    foreach ($a in $task.Actions) {
        if ($a.Execute -match 'AppData|srbminer|Caches' ) {
            Write-Output ("Task: {0}{1} -> {2} {3}" -f $task.TaskPath, $task.TaskName, $a.Execute, $a.Arguments)
        }
    }
}

Write-Output ""
Write-Output "=== Run keys (registry autorun) ==="
$runKeys = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce'
)
foreach ($k in $runKeys) {
    if (Test-Path $k) {
        $props = Get-ItemProperty -Path $k
        $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object {
            Write-Output ("{0} :: {1} = {2}" -f $k, $_.Name, $_.Value)
        }
    }
}

Write-Output ""
Write-Output "=== Parent processes of running miners ==="
Get-CimInstance Win32_Process -Filter "Name='SecurityHealthHost.exe'" -ErrorAction SilentlyContinue |
    Select-Object ProcessId, ParentProcessId, CommandLine |
    Format-List | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== Listening outbound connections from miners ==="
Get-CimInstance Win32_Process -Filter "Name='SecurityHealthHost.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
    $conns = Get-NetTCPConnection -OwningProcess $_.ProcessId -State Established -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        Write-Output ("PID {0} -> {1}:{2}" -f $_.ProcessId, $c.RemoteAddress, $c.RemotePort)
    }
}

try { Stop-Transcript | Out-Null } catch { }
