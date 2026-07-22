[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Command,

  [string] $WorkingDirectory = '.',

  [int] $TimeoutSeconds = 120,

  [int] $HeartbeatSeconds = 30,

  [string] $LogPath = '',

  [ValidateSet('ReadOnly', 'Idempotent', 'Stateful')]
  [string] $CommandType = 'Idempotent',

  [int] $MaxRetries = 0,

  [int] $TimeoutExitCode = 124
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-RecoveryLog($Message) {
  $timestamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz')
  $line = "[$timestamp] $Message"
  Write-Host $line
  if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  }
}

function Stop-ChildProcessTree([int]$ProcessId) {
  taskkill /PID $ProcessId /T /F 2>$null | Out-Null
  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
    Start-Sleep -Milliseconds 100
  }
}

$allowedRetries = switch ($CommandType) {
  'ReadOnly'   { [Math]::Min($MaxRetries, 2) }
  'Idempotent' { [Math]::Min($MaxRetries, 1) }
  'Stateful'   { 0 }
}

if ($CommandType -eq 'Stateful' -and $MaxRetries -gt 0) {
  Write-RecoveryLog 'STATEFUL: automatic retries disabled; state verification is required before any retry.'
}

$finalExitCode = 1
$attempt = 0
$startedAt = Get-Date

do {
  $attempt++

  $runnerPath = Join-Path ([System.IO.Path]::GetTempPath()) ('cascade-recovery-{0}.ps1' -f [guid]::NewGuid())
  $resolvedWorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path

  $env:CASCADE_RECOVERY_DIRECTORY = $resolvedWorkingDirectory
  $env:CASCADE_RECOVERY_COMMAND    = $Command

  $runnerScript = @'
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $env:CASCADE_RECOVERY_DIRECTORY
$global:LASTEXITCODE = 0
Invoke-Expression -Command $env:CASCADE_RECOVERY_COMMAND
exit $global:LASTEXITCODE
'@

  Set-Content -LiteralPath $runnerPath -Value $runnerScript -Encoding UTF8

  $attemptStartedAt = Get-Date
  Write-RecoveryLog "START attempt=$attempt type=$CommandType timeout=${TimeoutSeconds}s command=$Command"

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "$PSHOME\powershell.exe"
  $quotedRunner = if ($runnerPath -match '\s') { '"{0}"' -f $runnerPath } else { $runnerPath }
  $psi.Arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $quotedRunner) -join ' '
  $psi.WorkingDirectory = $resolvedWorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::Start($psi)
  if ($null -eq $process) {
    throw 'No se pudo iniciar el proceso hijo.'
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()

  $timedOut = $false
  $lastHeartbeatAt = Get-Date

  while (-not $process.HasExited) {
    $elapsed = ((Get-Date) - $attemptStartedAt).TotalSeconds

    if ($elapsed -ge $TimeoutSeconds) {
      $timedOut = $true
      Write-RecoveryLog "TIMEOUT reached after $TimeoutSeconds seconds; terminating child tree (pid=$($process.Id))"
      Stop-ChildProcessTree -ProcessId $process.Id
      try { $process.WaitForExit(5000) | Out-Null } catch {}
      break
    }

    if (((Get-Date) - $lastHeartbeatAt).TotalSeconds -ge $HeartbeatSeconds) {
      $lastHeartbeatAt = Get-Date
      Write-RecoveryLog "HEARTBEAT pid=$($process.Id) elapsed=${elapsed}s command=$Command"
    }

    Start-Sleep -Milliseconds 100
  }

  if (-not $timedOut) {
    $process.WaitForExit()
  }

  $stdoutText = $stdoutTask.Result
  $stderrText = $stderrTask.Result

  if (-not [string]::IsNullOrWhiteSpace($stdoutText) -and (-not [string]::IsNullOrWhiteSpace($LogPath))) {
    Add-Content -LiteralPath $LogPath -Value $stdoutText.TrimEnd() -Encoding UTF8
  }

  if (-not [string]::IsNullOrWhiteSpace($stderrText) -and (-not [string]::IsNullOrWhiteSpace($LogPath))) {
    Add-Content -LiteralPath $LogPath -Value $stderrText.TrimEnd() -Encoding UTF8
  }

  $attemptDuration = [Math]::Round(((Get-Date) - $attemptStartedAt).TotalSeconds, 2)

  if ($timedOut) {
    $finalExitCode = $TimeoutExitCode
  }
  elseif ($process.HasExited -and ($null -ne $process.ExitCode)) {
    $finalExitCode = $process.ExitCode
  }
  else {
    $finalExitCode = 1
  }

  Write-RecoveryLog "END attempt=$attempt duration=${attemptDuration}s exitCode=$finalExitCode timeout=$timedOut"

  Remove-Item -LiteralPath $runnerPath -Force -ErrorAction SilentlyContinue

  if ($finalExitCode -eq 0) {
    break
  }

  if ($attempt -le $allowedRetries) {
    $backoff = if ($attempt -eq 1) { 5 } else { 15 }
    Write-RecoveryLog "RETRY scheduled attempt=$($attempt + 1) backoff=${backoff}s"
    Start-Sleep -Seconds $backoff
  }
} while ($attempt -le $allowedRetries)

$totalDuration = [Math]::Round(((Get-Date) - $startedAt).TotalSeconds, 2)
$status = if ($finalExitCode -eq 0) { 'SUCCESS' } elseif ($timedOut) { 'TIMEOUT' } else { 'FAILED' }
Write-RecoveryLog "FINAL status=$status exitCode=$finalExitCode attempts=$attempt duration=${totalDuration}s"
exit $finalExitCode
