[CmdletBinding()]
param(
    [ValidatePattern('^[a-z][a-z0-9-]{4,61}[a-z0-9]$')][string]$ProjectId = 'qwiklabs-gcp-02-7df98c2d8335',
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]$')][string]$Region = 'asia-southeast1',
    [ValidatePattern('^[a-z][a-z0-9-]{0,61}[a-z0-9]$')][string]$Service = 'weliketrains',
    [string]$Gcloud = 'gcloud',
    [ValidateSet('Full', 'Fast')][string]$VerificationMode = 'Full',
    [switch]$AllowDirty,
    [switch]$AllowNonMain
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not (Get-Command $Gcloud -ErrorAction SilentlyContinue)) {
    $bundledCli = Join-Path $repoRoot '.local\gcloud\google-cloud-sdk\bin\gcloud.cmd'
    if (Test-Path -LiteralPath $bundledCli) { $Gcloud = $bundledCli }
    else { throw 'Google Cloud CLI was not found. Install it or pass -Gcloud with its path.' }
}

$npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
if (-not $npmCommand) { $npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue }
if (-not $npmCommand) { throw 'npm was not found.' }
if (-not (Get-Command 'git' -ErrorAction SilentlyContinue)) { throw 'git was not found.' }

$branch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not determine the current Git branch.' }
if (-not $AllowNonMain -and $branch -ne 'main') {
    throw "Refusing to deploy branch '$branch'. Switch to main or pass -AllowNonMain explicitly."
}

$changes = @(& git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git working tree.' }
if (-not $AllowDirty -and $changes.Count -gt 0) {
    throw 'Refusing to deploy an uncommitted working tree. Commit the intended source or pass -AllowDirty explicitly.'
}

$sourceRevision = (& git rev-parse '--short=12' HEAD).Trim().ToLowerInvariant()
if ($LASTEXITCODE -ne 0 -or -not $sourceRevision) { throw 'Could not determine the source revision.' }
$sourceLabel = if ($changes.Count -gt 0) { "$sourceRevision-dirty" } else { $sourceRevision }

$account = (& $Gcloud auth list '--filter=status:ACTIVE' '--format=value(account)').Trim()
if ($LASTEXITCODE -ne 0 -or -not $account) {
    throw 'No active Google Cloud CLI account was found. Run gcloud auth login first.'
}

$verificationScript = if ($VerificationMode -eq 'Fast') { 'verify:deploy:fast' } else { 'verify' }
if ($VerificationMode -eq 'Fast') {
    Write-Warning 'FAST deployment verification selected: production build, TypeScript and unit tests will run; Playwright will be skipped.'
}
Write-Host "Verification mode: $VerificationMode ($verificationScript); source: $sourceLabel"
$verificationTimer = [System.Diagnostics.Stopwatch]::StartNew()
& $npmCommand.Source run $verificationScript
$verificationTimer.Stop()
if ($LASTEXITCODE -ne 0) { throw 'Local verification failed; deployment was not started.' }
Write-Host ('Local verification completed in {0:N1}s.' -f $verificationTimer.Elapsed.TotalSeconds)

$uploadFiles = @(& $Gcloud meta list-files-for-upload)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Cloud Build upload set.' }
$unsafeUploads = @($uploadFiles | Where-Object {
    $_ -match '(^|[\\/])\.env($|\.)' -or
    $_ -match '(^|[\\/])gha-creds-[^\\/]+\.json$' -or
    $_ -match '(^|[\\/])\.local([\\/]|$)' -or
    $_ -match '(^|[\\/])\.credentials([\\/]|$)' -or
    $_ -match '(credentials|service-account)\.json$'
})
if ($unsafeUploads.Count -gt 0) {
    throw "Refusing to deploy because protected files are in the upload set: $($unsafeUploads -join ', ')"
}

$runtime = "$Service-runtime@$ProjectId.iam.gserviceaccount.com"
$builder = "projects/$ProjectId/serviceAccounts/$Service-builder@$ProjectId.iam.gserviceaccount.com"

Write-Host "Deploying $Service from local branch $branch to $ProjectId ($Region)."
$deploymentTimer = [System.Diagnostics.Stopwatch]::StartNew()
& $Gcloud run deploy $Service '--source=.' "--project=$ProjectId" "--region=$Region" "--service-account=$runtime" "--build-service-account=$builder" "--update-labels=wayce-verification=$($VerificationMode.ToLowerInvariant()),wayce-source=$sourceLabel" '--quiet'
$deploymentTimer.Stop()
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deployment failed. Inspect the regional Cloud Build log before retrying.' }

$serviceData = & $Gcloud run services describe $Service "--project=$ProjectId" "--region=$Region" '--format=json(status.url,status.latestReadyRevisionName)'
if ($LASTEXITCODE -ne 0) { throw 'Deployment completed, but the Cloud Run service could not be inspected.' }
$serviceStatus = $serviceData | ConvertFrom-Json
$url = [string]$serviceStatus.status.url
$revision = [string]$serviceStatus.status.latestReadyRevisionName
if (-not $url -or -not $revision) { throw 'Cloud Run did not report a ready revision and URL.' }

$health = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 30
if ($health.status -ne 'ok') { throw "Revision $revision did not pass the application health check." }

Write-Host "Deployment verified: $revision"
Write-Host "Verification mode: $VerificationMode; source: $sourceLabel"
Write-Host ('Cloud deployment and health verification completed in {0:N1}s.' -f $deploymentTimer.Elapsed.TotalSeconds)
Write-Host $url
