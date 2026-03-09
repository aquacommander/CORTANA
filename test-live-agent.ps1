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

Write-Host "=== Live Agent Multi-Turn Test ===" -ForegroundColor Cyan

$session = (Invoke-Json "POST" "$BaseUrl/api/session/create" @{ goal = "Launch my new brand story" }).session
$sessionId = $session.sessionId
Write-Host "Session: $sessionId"

$step1 = Invoke-Json "POST" "$BaseUrl/api/live/message" @{
  sessionId = $sessionId
  message   = "I need help promoting my new product"
}
Assert-True ($step1.liveIntent.readyForStoryGeneration -eq $false) "Step 1 should not be ready yet"
Assert-True (($step1.liveIntent.missingFields | Measure-Object).Count -ge 1) "Step 1 should return missingFields"
Write-Host "Step 1 missing: $($step1.liveIntent.missingFields -join ', ')"
Write-Host "Step 1 reply: $($step1.reply)"

$step2 = Invoke-Json "POST" "$BaseUrl/api/live/message" @{
  sessionId = $sessionId
  message   = "Audience is kids"
}
Assert-True ($step2.liveIntent.readyForStoryGeneration -eq $false) "Step 2 should still be incomplete"
Assert-True ($step2.liveIntent.audience -eq "kids") "Step 2 should capture audience"
Assert-True ($step2.liveIntent.missingFields -contains "tone") "Step 2 should still need tone"
Assert-True ($step2.liveIntent.missingFields -contains "platform") "Step 2 should still need platform"
Write-Host "Step 2 missing: $($step2.liveIntent.missingFields -join ', ')"
Write-Host "Step 2 reply: $($step2.reply)"

$step3 = Invoke-Json "POST" "$BaseUrl/api/live/message" @{
  sessionId = $sessionId
  message   = "Tone is playful"
}
Assert-True ($step3.liveIntent.readyForStoryGeneration -eq $false) "Step 3 should still be incomplete"
Assert-True ($step3.liveIntent.tone -eq "playful") "Step 3 should capture tone"
Assert-True ($step3.liveIntent.missingFields -contains "platform") "Step 3 should still need platform"
Write-Host "Step 3 missing: $($step3.liveIntent.missingFields -join ', ')"
Write-Host "Step 3 reply: $($step3.reply)"

$step4 = Invoke-Json "POST" "$BaseUrl/api/live/message" @{
  sessionId = $sessionId
  message   = "Platform is instagram"
}
Assert-True ($step4.liveIntent.platform -eq "instagram") "Step 4 should capture platform"
Assert-True ($step4.liveIntent.readyForStoryGeneration -eq $true) "Step 4 should be ready for storyteller"
Write-Host "Step 4 reply: $($step4.reply)"

$sessionAfter = (Invoke-Json "GET" "$BaseUrl/api/session/$sessionId").session
Assert-True ($sessionAfter.workflowStage -eq "STORY_GENERATION") "Session stage should advance to STORY_GENERATION"
Write-Host "Session stage after intake: $($sessionAfter.workflowStage)"
Write-Host "PASS: Live Agent multi-turn slot filling works." -ForegroundColor Green
