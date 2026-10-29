$pids = 34592,19192,27280,22752,9952,21724,1952,4872,34240,32324,32180,4892,9000,35592,26468,14096
foreach ($procId in $pids) {
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
        $memMB = [math]::Round($p.WorkingSet64/1MB)
        $cpu = 'n/a'
        if ($null -ne $p.CPU) { $cpu = [math]::Round($p.CPU,1) }
        $path = 'n/a'
        try { if ($p.Path) { $path = $p.Path } } catch {}
        Write-Output ("PID {0,-6} {1,-30} RAM {2,6} MB  CPU(s) {3,8}  Path: {4}" -f $procId, $p.ProcessName, $memMB, $cpu, $path)
    } else {
        Write-Output ("PID {0,-6} (already exited)" -f $procId)
    }
}
