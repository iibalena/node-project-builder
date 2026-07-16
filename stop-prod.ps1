# stop-prod.ps1 - para API (:2999) e Runner (:3002)
function Stop-Port($port) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
Stop-Port 2999
Stop-Port 3002
Write-Host 'API e Runner parados.'
