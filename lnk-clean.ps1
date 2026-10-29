$l = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\RuntimeHost.lnk"
if (Test-Path $l) {
    $sh = New-Object -ComObject WScript.Shell
    $sc = $sh.CreateShortcut($l)
    Write-Output ("Target: " + $sc.TargetPath)
    Write-Output ("Args: " + $sc.Arguments)
    Remove-Item $l -Force
    Write-Output "Deleted."
} else { Write-Output "not found" }

Write-Output ""
Write-Output "=== Quarantine contents (root files) ==="
Get-ChildItem 'E:\IT\alex-glad-challenge\quarantine-miner' -Recurse -Depth 1 -File -ErrorAction SilentlyContinue |
    Select-Object Length, FullName | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
