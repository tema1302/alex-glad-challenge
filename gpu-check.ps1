# GPU usage diagnostic
$engineSamples = Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples 3 -ErrorAction SilentlyContinue
$topEngines = $engineSamples | ForEach-Object { $_.CounterSamples } |
    Where-Object { $_.CookedValue -gt 3 } |
    Group-Object InstanceName |
    ForEach-Object {
        [PSCustomObject]@{
            Engine  = $_.Name
            AvgUtil = [math]::Round(($_.Group | Measure-Object CookedValue -Average).Average, 1)
        }
    } | Sort-Object AvgUtil -Descending | Select-Object -First 10

Write-Output "=== GPU engines with load > 3% ==="
$topEngines | Format-Table -AutoSize

Write-Output ""
Write-Output "=== Processes using dedicated VRAM (>100 MB) ==="
$mem = Get-Counter '\GPU Process Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue
$mem.CounterSamples |
    Where-Object { $_.CookedValue -gt 100MB } |
    Sort-Object CookedValue -Descending |
    Select-Object -First 10 @{n='Process';e={$_.InstanceName}}, @{n='VRAM_MB';e={[math]::Round($_.CookedValue/1MB)}} |
    Format-Table -AutoSize

Write-Output ""
Write-Output "=== Overall GPU adapter summary ==="
$adapters = Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction SilentlyContinue
$adapters.CounterSamples |
    Sort-Object CookedValue -Descending |
    Select-Object -First 4 @{n='Adapter';e={$_.InstanceName}}, @{n='VRAM_MB';e={[math]::Round($_.CookedValue/1MB)}} |
    Format-Table -AutoSize
