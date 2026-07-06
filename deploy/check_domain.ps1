param(
  [Parameter(Mandatory = $true)]
  [string]$Domain,
  [string]$CodeDomain,
  [string]$ExpectedIp = ""
)

$ErrorActionPreference = "Stop"

function Resolve-NameValue {
  param([string]$Name)
  try {
    $records = Resolve-DnsName -Name $Name -Type A -ErrorAction Stop
    return @($records | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress)
  } catch {
    return @()
  }
}

function Test-Url {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Head -TimeoutSec 15
    return [pscustomobject]@{ Url = $Url; Ok = $true; Status = $response.StatusCode }
  } catch {
    return [pscustomobject]@{ Url = $Url; Ok = $false; Status = $_.Exception.Message }
  }
}

$domainIps = Resolve-NameValue $Domain
$codeIps = Resolve-NameValue $CodeDomain

$result = [ordered]@{
  domain = $Domain
  domain_ips = $domainIps
  code_domain = $CodeDomain
  code_domain_ips = $codeIps
  expected_ip = $ExpectedIp
  domain_matches_expected = if ($ExpectedIp) { $domainIps -contains $ExpectedIp } else { $null }
  code_matches_expected = if ($ExpectedIp) { $codeIps -contains $ExpectedIp } else { $null }
  checks = @(
    Test-Url "http://$Domain/"
    Test-Url "https://$Domain/"
    Test-Url "https://$Domain/admin/"
    Test-Url "https://$CodeDomain/"
  )
}

$result | ConvertTo-Json -Depth 4
