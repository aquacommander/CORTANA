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

Write-Host "=== Live Realtime Session Test ===" -ForegroundColor Cyan

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Realtime live validation" }).session
$sessionId = $session.sessionId
Write-Host "Session: $sessionId"

$start = Invoke-Json "POST" "$BaseUrl/api/live/realtime/session/start" @{ sessionId = $sessionId }
Assert-True (-not [string]::IsNullOrWhiteSpace($start.liveSessionId)) "liveSessionId should be created"
Assert-True (-not [string]::IsNullOrWhiteSpace($start.mode)) "mode should be returned"
Write-Host "Realtime mode: $($start.mode)"
Write-Host "Live session: $($start.liveSessionId)"

$msg = Invoke-Json "POST" "$BaseUrl/api/live/realtime/session/$($start.liveSessionId)/message" @{
  message = "I need help with a sports campaign"
}
Assert-True (-not [string]::IsNullOrWhiteSpace($msg.reply)) "Realtime reply should not be empty"
Write-Host "Realtime reply: $($msg.reply)"

$stop = Invoke-Json "POST" "$BaseUrl/api/live/realtime/session/$($start.liveSessionId)/stop"
Assert-True ($stop.stopped -eq $true) "Realtime session should stop cleanly"

Write-Host "PASS: realtime session endpoints are functional." -ForegroundColor Green
