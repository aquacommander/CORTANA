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

Write-Host "=== Playwright Mode Test ===" -ForegroundColor Cyan

$html = @"
<!doctype html>
<html>
  <body>
    <form>
      <input id="title" type="text" />
      <textarea id="description"></textarea>
      <button type="submit">Publish</button>
    </form>
  </body>
</html>
"@

$targetUrl = "data:text/html," + [System.Uri]::EscapeDataString($html)

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Playwright mode validation" }).session
$sessionId = $session.sessionId
Write-Host "Session: $sessionId"

Invoke-Json "POST" "$BaseUrl/api/live/message" @{ sessionId = $sessionId; message = "publish for instagram kids fun tone" } | Out-Null
Invoke-Json "POST" "$BaseUrl/api/story/generate" @{ sessionId = $sessionId } | Out-Null

$analyze = Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{
  sessionId = $sessionId
  screenshotBase64 = "ZmFrZQ=="
  targetUrl = $targetUrl
}
Assert-True ($analyze.navigatorPlan.actionPlan.Count -ge 2) "Expected at least 2 actions from analyzer"
Write-Host "Analyze actions: $($analyze.navigatorPlan.actionPlan.Count)"
Write-Host "Analyze note: $($analyze.navigatorPlan.notes)"

$execute = Invoke-Json "POST" "$BaseUrl/api/navigator/execute" @{
  sessionId = $sessionId
  mode = "playwright"
  targetUrl = $targetUrl
  headless = $true
}
$result = $execute.executionResult
Write-Host "Execution status: $($result.status)"
Write-Host "Completed actions: $($result.completedActions)"
if ($result.error) {
  Write-Host "Execution error: $($result.error)"
}

Assert-True ($result.status -ne "failed") "Playwright execution should not be fully failed on deterministic test page"
Assert-True ($result.completedActions -ge 2) "Expected at least 2 completed actions in playwright mode"

$final = (Invoke-Json "GET" "$BaseUrl/api/session/$sessionId").session
Assert-True ($final.workflowStage -eq "COMPLETION") "Final stage should be COMPLETION"
Assert-True ($final.status -in @("completed", "failed")) "Final status should be populated"

Write-Host "PASS: playwright mode test completed." -ForegroundColor Green
