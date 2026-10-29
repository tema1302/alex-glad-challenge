Write-Output "=== 1. Files created today 09:40-10:00 in user profile (excl. caches) ==="
$s = Get-Date '2026-10-29 09:40'
$e = Get-Date '2026-10-29 10:00'
Get-ChildItem "$env:USERPROFILE" -Recurse -Force -ErrorAction SilentlyContinue -File |
    Where-Object { $_.CreationTime -ge $s -and $_.CreationTime -le $e -and $_.FullName -notmatch 'Cache|Temp|Packages|npm-cache|\.git\\' } |
    Sort-Object CreationTime |
    Select-Object CreationTime, Length, FullName |
    Format-Table -AutoSize | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 2. First lines of log.txt (second malware log) ==="
$lt = 'E:\IT\alex-glad-challenge\quarantine-miner\Caches-4259B89A-bb1d5e\log.txt'
if (Test-Path $lt) { Get-Content $lt -TotalCount 30 | ForEach-Object { Write-Output $_ } }

Write-Output ""
Write-Output "=== 3. Moshi hook.log ==="
$hl = "$env:LOCALAPPDATA\Moshi\hook.log"
if (Test-Path $hl) { Get-Content $hl -TotalCount 50 | ForEach-Object { Write-Output $_ } }

Write-Output ""
Write-Output "=== 4. Hashes: moshi-hook vs RuntimeHost ==="
$f1 = "$env:LOCALAPPDATA\Programs\Moshi Hook\bin\moshi-hook.exe"
$f2 = 'E:\IT\alex-glad-challenge\quarantine-miner\Caches-4259B89A-bb1d5e\RuntimeHost.exe'
foreach ($f in @($f1,$f2)) {
    if (Test-Path $f) {
        $h = Get-FileHash $f -Algorithm SHA256
        Write-Output ("{0}  {1}" -f $h.Hash, $f)
    }
}

Write-Output ""
Write-Output "=== 5. Defender detections BEFORE today ==="
Get-MpThreatDetection -ErrorAction SilentlyContinue |
    Where-Object { $_.InitialDetectionTime -lt (Get-Date '2026-10-29') } |
    Sort-Object InitialDetectionTime |
    Select-Object InitialDetectionTime, ThreatID, @{n='Res';e={("$($_.Resources)").Substring(0,[Math]::Min(200,("$($_.Resources)").Length))}} |
    Format-List | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 6. What are moshi hooks registered to run? ==="
$hooks = @("$env:USERPROFILE\.codex\hooks.json", "$env:USERPROFILE\.claude\moshi-plugin\hooks\hooks.json", "$env:USERPROFILE\.gemini\config\hooks.json")
foreach ($h in $hooks) {
    if (Test-Path $h) {
        Write-Output "--- $h ---"
        Get-Content $h -Raw | ForEach-Object { Write-Output $_.Substring(0, [Math]::Min(800, $_.Length)) }
    }
}
