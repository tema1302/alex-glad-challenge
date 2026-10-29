Write-Output "=== 1. Timestamps inside quarantined malware folders ==="
Get-ChildItem 'E:\IT\alex-glad-challenge\quarantine-miner' -Recurse -Force -ErrorAction SilentlyContinue |
    Sort-Object CreationTime |
    Select-Object CreationTime, LastWriteTime, Length, FullName |
    Format-Table -AutoSize | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 2. Moshi Hook folder contents ==="
$mh = "$env:LOCALAPPDATA\Programs\Moshi Hook"
if (Test-Path $mh) {
    Get-ChildItem $mh -Recurse -Force -ErrorAction SilentlyContinue |
        Select-Object CreationTime, LastWriteTime, Length, FullName |
        Sort-Object CreationTime |
        Format-Table -AutoSize | Out-String -Width 250 | Write-Output
}

Write-Output ""
Write-Output "=== 3. Files created 22.10 between 14:00 and 15:30 across user profile ==="
$s = Get-Date '2026-10-22 14:00'
$e = Get-Date '2026-10-22 15:30'
Get-ChildItem "$env:USERPROFILE" -Recurse -Force -ErrorAction SilentlyContinue -File |
    Where-Object { $_.CreationTime -ge $s -and $_.CreationTime -le $e -and $_.FullName -notmatch '\\AppData\\Local\\(Google|Microsoft\\Edge|Yandex|Temp|Packages)\\' } |
    Sort-Object CreationTime |
    Select-Object CreationTime, Length, FullName |
    Format-Table -AutoSize | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 4. Defender full threat history (last 20) ==="
Get-MpThreat -ErrorAction SilentlyContinue | Select-Object -First 20 ThreatName, ThreatID, SeverityID, DidThreatExecute, IsActive, Resources |
    Format-List | Out-String -Width 250 | Write-Output
