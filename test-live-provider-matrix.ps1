param(
  [string]$BaseUrl = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"

function Assert-True($condition, $message) {
  if (-not $condition) { throw $message }
}

Write-Host "=== Live Provider Matrix Test ===" -ForegroundColor Cyan

$matrix = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/live/realtime/provider-matrix"
Assert-True ($matrix.supportedProviders.Count -ge 3) "supportedProviders should include 3 provider modes"
Assert-True ($matrix.activeProvider -in $matrix.supportedProviders) "activeProvider should be one of supportedProviders"
Assert-True ($null -ne $matrix.strictMode) "strictMode field should be present"
Assert-True (-not [string]::IsNullOrWhiteSpace($matrix.liveModel)) "liveModel should be present"

Write-Host "Active provider: $($matrix.activeProvider)"
Write-Host "Live model: $($matrix.liveModel)"
Write-Host "Strict mode: $($matrix.strictMode)"
Write-Host "ADK endpoint configured: $($matrix.adkEndpointConfigured)"
Write-Host "Supported: $($matrix.supportedProviders -join ', ')"
Write-Host "PASS: provider matrix endpoint is valid." -ForegroundColor Green
