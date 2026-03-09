param(
  [string]$BaseUrl = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"

function Assert-True($condition, $message) {
  if (-not $condition) { throw $message }
}

function Invoke-Json([string]$Method, [string]$Url, $Body = $null) {
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Url
  }
  return Invoke-RestMethod -Method $Method -Uri $Url -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 20)
}

Write-Host "=== Navigator Recording Analyze Test ===" -ForegroundColor Cyan

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Navigator recording test" }).session
$sessionId = $session.sessionId

Invoke-Json "POST" "$BaseUrl/api/live/message" @{ sessionId = $sessionId; message = "publish for instagram kids fun tone" } | Out-Null
Invoke-Json "POST" "$BaseUrl/api/story/generate" @{ sessionId = $sessionId } | Out-Null

# Minimal base64 placeholders are accepted for contract/testing path verification.
$analyze = Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{
  sessionId = $sessionId
  screenshotBase64 = "ZmFrZQ=="
  screenRecordingBase64 = "ZmFrZVZpZGVv"
}

Assert-True ($analyze.navigatorPlan.actionPlan.Count -ge 1) "Action plan should not be empty"
Assert-True (-not [string]::IsNullOrWhiteSpace($analyze.navigatorPlan.notes)) "Plan notes should be present"

Write-Host "Analyze actions: $($analyze.navigatorPlan.actionPlan.Count)"
Write-Host "Analyze notes: $($analyze.navigatorPlan.notes)"
Write-Host "PASS: navigator recording analyze path works." -ForegroundColor Green
