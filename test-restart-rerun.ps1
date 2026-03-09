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

Write-Host "=== Restart + Re-run Test ===" -ForegroundColor Cyan

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Restart and rerun validation" }).session
$sessionId = $session.sessionId
Write-Host "Session: $sessionId"

Invoke-Json "POST" "$BaseUrl/api/live/message" @{ sessionId = $sessionId; message = "publish for instagram kids fun tone" } | Out-Null
Invoke-Json "POST" "$BaseUrl/api/story/generate" @{ sessionId = $sessionId } | Out-Null
Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{ sessionId = $sessionId; screenshotBase64 = "ZmFrZQ==" } | Out-Null
$exec1 = (Invoke-Json "POST" "$BaseUrl/api/navigator/execute" @{ sessionId = $sessionId; mode = "mock" }).executionResult
Assert-True ($exec1.status -eq "success") "Initial execute should be success"
Write-Host "Initial execute: $($exec1.status)"

$restarted = (Invoke-Json "POST" "$BaseUrl/api/session/$sessionId/restart-from-review").session
Assert-True ($restarted.workflowStage -eq "STORY_REVIEW") "Restart should move to STORY_REVIEW"
Assert-True ($restarted.status -eq "active") "Restart should reactivate session"
Write-Host "Restarted stage: $($restarted.workflowStage)"

Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{ sessionId = $sessionId; screenshotBase64 = "ZmFrZQ==" } | Out-Null
$exec2 = (Invoke-Json "POST" "$BaseUrl/api/navigator/execute" @{ sessionId = $sessionId; mode = "mock" }).executionResult
Assert-True ($exec2.status -eq "success") "Rerun execute should be success"
Write-Host "Rerun execute: $($exec2.status)"

$final = (Invoke-Json "GET" "$BaseUrl/api/session/$sessionId").session
Assert-True ($final.workflowStage -eq "COMPLETION") "Final stage should be COMPLETION"
Assert-True ($final.status -eq "completed") "Final status should be completed"
Write-Host "Final stage: $($final.workflowStage)"
Write-Host "Final status: $($final.status)"
Write-Host "PASS: restart + rerun flow works." -ForegroundColor Green
