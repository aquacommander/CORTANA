param(
  [string]$BaseUrl = "http://localhost:8787"
)

$ErrorActionPreference = "Stop"

function Write-Pass($name, $details) {
  Write-Host "[PASS] $name - $details" -ForegroundColor Green
}

function Write-Fail($name, $details) {
  Write-Host "[FAIL] $name - $details" -ForegroundColor Red
}

function Assert-True($condition, $name, $details) {
  if ($condition) {
    Write-Pass $name $details
  } else {
    Write-Fail $name $details
    throw "Assertion failed: $name"
  }
}

function Invoke-Json([string]$Method, [string]$Url, $Body = $null) {
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Url
  }
  $jsonBody = $Body | ConvertTo-Json -Depth 20
  return Invoke-RestMethod -Method $Method -Uri $Url -ContentType "application/json" -Body $jsonBody
}

function Get-ErrorBody([scriptblock]$Operation) {
  try {
    & $Operation | Out-Null
    return $null
  } catch {
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      return $_.ErrorDetails.Message
    }
    return $_.Exception.Message
  }
}

Write-Host ""
Write-Host "=== Creative Storyteller Workflow Test ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl"
Write-Host ""

# Test 1: Health
$health = Invoke-Json "GET" "$BaseUrl/api/health"
Assert-True ($health.status -eq "ok") "Health endpoint" ("status=" + $health.status)

# Test 2: Validation - create session missing goal
$createNoGoalError = Get-ErrorBody {
  Invoke-Json "POST" "$BaseUrl/api/session/create" @{}
}
Assert-True ($createNoGoalError -match "Goal is required") "Create session validation" $createNoGoalError

# Test 3: Create session
$goal = "Launch a cinematic hello world story"
$createResponse = Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = $goal }
$session = $createResponse.session
Assert-True (-not [string]::IsNullOrWhiteSpace($session.sessionId)) "Session creation" ("sessionId=" + $session.sessionId)
Assert-True ($session.workflowStage -eq "INTAKE") "Initial workflow stage" ("workflowStage=" + $session.workflowStage)
Assert-True ($session.status -eq "active") "Initial session status" ("status=" + $session.status)

$sessionId = $session.sessionId

# Test 4: Live message intent extraction
$liveResponse = Invoke-Json "POST" "$BaseUrl/api/live/message" @{
  sessionId = $sessionId
  message   = "Please publish this on instagram for kids in a fun tone"
}
Assert-True ($liveResponse.liveIntent.intent -eq "publish_story") "Live intent: intent" ("intent=" + $liveResponse.liveIntent.intent)
Assert-True ($liveResponse.liveIntent.audience -eq "kids") "Live intent: audience" ("audience=" + $liveResponse.liveIntent.audience)
Assert-True ($liveResponse.liveIntent.platform -eq "instagram") "Live intent: platform" ("platform=" + $liveResponse.liveIntent.platform)
Assert-True ($liveResponse.liveIntent.tone -eq "playful") "Live intent: tone" ("tone=" + $liveResponse.liveIntent.tone)
Assert-True ($liveResponse.liveIntent.readyForStoryGeneration -eq $true) "Live intent: readiness" "readyForStoryGeneration=true"

# Test 5: Story generation
$storyResponse = Invoke-Json "POST" "$BaseUrl/api/story/generate" @{ sessionId = $sessionId }
$story = $storyResponse.storyOutput
Assert-True (-not [string]::IsNullOrWhiteSpace($story.storyId)) "Story generation id" ("storyId=" + $story.storyId)
Assert-True ($story.blocks.Count -ge 3) "Story generation blocks" ("blocks=" + $story.blocks.Count)

# Test 6: Validation - analyze missing screenshot
$analyzeNoScreenshotError = Get-ErrorBody {
  Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{ sessionId = $sessionId }
}
Assert-True ($analyzeNoScreenshotError -match "screenshotBase64 is required") "Analyze validation" $analyzeNoScreenshotError

# Test 7: Navigator analyze
$analyzeResponse = Invoke-Json "POST" "$BaseUrl/api/navigator/analyze" @{
  sessionId = $sessionId
  screenshotBase64 = "ZmFrZQ==" # "fake" in base64; endpoint only checks presence in MVP
}
Assert-True ($analyzeResponse.navigatorPlan.actionPlan.Count -ge 1) "Navigator analyze action plan" ("actions=" + $analyzeResponse.navigatorPlan.actionPlan.Count)

# Test 8: Navigator execute
$executeResponse = Invoke-Json "POST" "$BaseUrl/api/navigator/execute" @{ sessionId = $sessionId }
$exec = $executeResponse.executionResult
Assert-True ($exec.status -eq "success") "Navigator execute status" ("status=" + $exec.status)
Assert-True ($exec.completedActions -ge 1) "Navigator execute actions" ("completedActions=" + $exec.completedActions)

# Test 9: Final session state
$finalResponse = Invoke-Json "GET" "$BaseUrl/api/session/$sessionId"
$finalSession = $finalResponse.session
Assert-True ($finalSession.workflowStage -eq "COMPLETION") "Final workflow stage" ("workflowStage=" + $finalSession.workflowStage)
Assert-True ($finalSession.status -eq "completed") "Final session status" ("status=" + $finalSession.status)
Assert-True ($finalSession.logs.Count -ge 1) "Final logs exist" ("logs=" + $finalSession.logs.Count)

Write-Host ""
Write-Host "All tests passed." -ForegroundColor Green
Write-Host "Final session ID: $sessionId"
Write-Host ""
