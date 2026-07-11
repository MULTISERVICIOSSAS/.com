param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,
  [string]$User = "root",
  [string]$AppDir = "/var/www/multiservicios",
  [string]$Branch = "main",
  [string]$PublicUrl = "",
  [string]$CertificateCode = ""
)

$ErrorActionPreference = "Stop"
$remote = "$User@$HostName"
$cmd = "cd '$AppDir' && BRANCH='$Branch' bash deploy/deploy_pull.sh"
ssh $remote $cmd
if ($LASTEXITCODE -ne 0) {
  throw "El despliegue remoto fallo."
}

if ($PublicUrl) {
  $arguments = @("deploy/verify_production.py", "--base-url", $PublicUrl)
  if ($CertificateCode) {
    $arguments += @("--certificate-code", $CertificateCode)
  }
  python @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "La verificacion publica fallo."
  }
}
