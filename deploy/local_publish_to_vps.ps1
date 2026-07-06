param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "root",
  [string]$AppDir = "/var/www/multiservicios",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$remote = "$User@$HostName"
$cmd = "cd '$AppDir' && git pull --ff-only origin '$Branch' && sudo systemctl restart multiservicios && sudo nginx -t && sudo systemctl reload nginx"
ssh $remote $cmd
