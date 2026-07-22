[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$ChecklistPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("PreCommit", "Final")]
  [string]$Stage
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-GitValue {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $value = & git @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo ejecutar git $($Arguments -join ' ')."
  }

  return ($value | Out-String).Trim()
}

$passed = $true

if (-not (Test-Path -LiteralPath $ChecklistPath -PathType Leaf)) {
  Write-Host "[FAIL] Checklist inexistente: $ChecklistPath" -ForegroundColor Red
  exit 1
}

$checklistLines = Get-Content -LiteralPath $ChecklistPath
$pendingStatuses = @("PENDING", "IN_PROGRESS", "FAIL", "BLOCKED")
$pendingPattern = "^\s*\|.*\b(" + ($pendingStatuses -join "|") + ")\b.*\|\s*$"
$pendingRows = @($checklistLines | Where-Object { $_ -match $pendingPattern })
$gridTestRoot = Join-Path $PSScriptRoot "..\server\services\gridIsolated"
$skippedPattern = "\b(it|test|describe)\.skip\s*\("
$skippedTests = @()

if (Test-Path -LiteralPath $gridTestRoot -PathType Container) {
  $skippedTests = @(Get-ChildItem -LiteralPath $gridTestRoot -Recurse -File -Include "*.test.ts", "*.spec.ts" |
    Select-String -Pattern $skippedPattern)
}

$diffCheckOutput = & git diff --check 2>&1
$diffCheckPassed = $LASTEXITCODE -eq 0
$status = Get-GitValue -Arguments @("status", "--short")
$head = Get-GitValue -Arguments @("rev-parse", "HEAD")
$originMain = Get-GitValue -Arguments @("rev-parse", "origin/main")

Write-Host "Cascade completion verifier - Stage: $Stage"
Write-Host "Checklist: $ChecklistPath"
Write-Host "HEAD: $head"
Write-Host "origin/main: $originMain"
Write-Host "Working tree: $(if ([string]::IsNullOrWhiteSpace($status)) { 'clean' } else { 'changes detected' })"
Write-Host "Checklist rows with pending status: $($pendingRows.Count)"
Write-Host "Critical Grid skipped tests: $($skippedTests.Count)"
Write-Host "git diff --check: $(if ($diffCheckPassed) { 'pass' } else { 'fail' })"

if ($pendingRows.Count -gt 0) {
  Write-Host "[INFO] Checklist rows requiring attention:" -ForegroundColor Yellow
  $pendingRows | ForEach-Object { Write-Host "  $_" }
}

if ($skippedTests.Count -gt 0) {
  Write-Host "[INFO] Critical Grid skipped tests:" -ForegroundColor Yellow
  $skippedTests | ForEach-Object { Write-Host "  $($_.Path):$($_.LineNumber) $($_.Line.Trim())" }
}

if (-not $diffCheckPassed) {
  Write-Host "[FAIL] git diff --check detected errors:" -ForegroundColor Red
  $diffCheckOutput | ForEach-Object { Write-Host "  $_" }
  $passed = $false
}

if ($Stage -eq "Final") {
  if ($pendingRows.Count -gt 0) {
    Write-Host "[FAIL] Final requires zero pending checklist states." -ForegroundColor Red
    $passed = $false
  }

  if ($skippedTests.Count -gt 0) {
    Write-Host "[FAIL] Final requires zero skipped critical Grid tests." -ForegroundColor Red
    $passed = $false
  }

  if (-not [string]::IsNullOrWhiteSpace($status)) {
    Write-Host "[FAIL] Final requires a clean working tree." -ForegroundColor Red
    $passed = $false
  }

  if ($head -ne $originMain) {
    Write-Host "[FAIL] Final requires HEAD = origin/main." -ForegroundColor Red
    $passed = $false
  }
}

if ($passed) {
  Write-Host "[PASS] Verification completed." -ForegroundColor Green
  exit 0
}

Write-Host "[FAIL] Verification incomplete." -ForegroundColor Red
exit 1
