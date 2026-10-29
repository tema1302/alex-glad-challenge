$start = Get-Date '2026-10-29 09:30'
$end   = Get-Date '2026-10-29 10:30'

Write-Output "=== 1. Files created/modified today 09:30-10:30 in Downloads/Desktop/Documents ==="
$dirs = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents")
foreach ($d in $dirs) {
    if (Test-Path $d) {
        Get-ChildItem -Path $d -Recurse -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.CreationTime -ge $start -and $_.CreationTime -le $end } |
            Sort-Object CreationTime |
            Select-Object CreationTime, Length, FullName |
            Format-Table -AutoSize | Out-String -Width 250 | Write-Output
    }
}

Write-Output ""
Write-Output "=== 2. Prefetch: what executed around infection time ==="
Get-ChildItem 'C:\Windows\Prefetch' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $start -and $_.LastWriteTime -le (Get-Date '2026-10-29 11:00') } |
    Sort-Object LastWriteTime |
    Select-Object LastWriteTime, Name |
    Format-Table -AutoSize | Out-String -Width 200 | Write-Output

Write-Output ""
Write-Output "=== 3. Recently installed programs (by registry InstallDate) ==="
$uninst = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $uninst -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -and $_.InstallDate -ge '20261020' } |
    Sort-Object InstallDate -Descending |
    Select-Object InstallDate, DisplayName, Publisher, InstallLocation |
    Format-Table -AutoSize | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 4. Defender detections history ==="
Get-MpThreatDetection -ErrorAction SilentlyContinue |
    Sort-Object InitialDetectionTime -Descending |
    Select-Object -First 10 InitialDetectionTime, ThreatID, Resources |
    Format-List | Out-String -Width 250 | Write-Output

Write-Output ""
Write-Output "=== 5. Suspicious autostart items already present ==="
$suspects = @(
    "$env:LOCALAPPDATA\GameCenter\GameCenter.exe",
    "$env:LOCALAPPDATA\Programs\Moshi Hook\bin\moshi-hook.exe",
    "$env:LOCALAPPDATA\FigmaAgent\figma_agent.exe"
)
foreach ($s in $suspects) {
    if (Test-Path $s) {
        $f = Get-Item $s
        $sig = Get-AuthenticodeSignature $s
        Write-Output ("{0}`n  created {1}  modified {2}  size {3}  sig: {4} ({5})" -f $s, $f.CreationTime, $f.LastWriteTime, $f.Length, $sig.Status, $sig.SignerCertificate.Subject)
    }
}

Write-Output ""
Write-Output "=== 6. PowerShell/script execution events around 10:00-10:20 ==="
try {
    Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-PowerShell/Operational'; StartTime=$start; EndTime=$end} -MaxEvents 20 -ErrorAction Stop |
        Select-Object TimeCreated, Id, @{n='Msg';e={$_.Message.Substring(0,[Math]::Min(150,$_.Message.Length))}} |
        Format-List | Out-String -Width 250 | Write-Output
} catch { Write-Output "no PS events or log disabled" }
