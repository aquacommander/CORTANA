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

Write-Host "=== Playwright Upload Action Test ===" -ForegroundColor Cyan

$html = @"
<!doctype html>
<html>
  <body>
    <form>
      <input id="title" type="text" />
      <textarea id="description"></textarea>
      <textarea id="caption"></textarea>
      <input id="tags" type="text" />
      <input id="upload" type="file" />
      <button type="submit">Publish</button>
    </form>
  </body>
</html>
"@

$targetUrl = "data:text/html," + [System.Uri]::EscapeDataString($html)

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Playwright upload test" }).session
$sessionId = $session.sessionId

Invoke-Json "POST" "$BaseUrl/api/live/message" @{ sessionId = $sessionId; message = "publish for instagram kids fun tone" } | Out-Null

# Provide a deterministic remote image URL so upload_file can download and attach it.
Invoke-Json "POST" "$BaseUrl/api/story/generate" @{
  sessionId = $sessionId
  imageUrl = "https://picsum.photos/200"
  videoUrl = "https://example.com/video.mp4"
  generateAssets = $false
} | Out-Null

$analyze = Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{
  sessionId = $sessionId
  screenshotBase64 = "ZmFrZQ=="
  targetUrl = $targetUrl
}

$uploadSteps = @($analyze.navigatorPlan.actionPlan | Where-Object { $_.action -eq "upload_file" })
Assert-True ($uploadSteps.Count -ge 1) "Expected upload_file action in analyzer plan"
Write-Host "Upload actions in plan: $($uploadSteps.Count)"

$execute = Invoke-Json "POST" "$BaseUrl/api/navigator/execute" @{
  sessionId = $sessionId
  mode = "playwright"
  targetUrl = $targetUrl
  headless = $true
}

$result = $execute.executionResult
Write-Host "Execution status: $($result.status)"
Write-Host "Completed actions: $($result.completedActions)"

Assert-True ($result.status -ne "failed") "Playwright upload flow should not fully fail"
Assert-True ($result.completedActions -ge 4) "Expected multiple actions including upload/type/click"

Write-Host "PASS: playwright upload action works." -ForegroundColor Green
