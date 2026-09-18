param(
    [ValidatePattern('^[a-z][a-z0-9-]{4,61}[a-z0-9]$')][string]$ProjectId = 'qwiklabs-gcp-02-7df98c2d8335',
    [ValidatePattern('^[a-z]+-[a-z]+[0-9]$')][string]$Region = 'asia-southeast1',
    [switch]$EnableReminders,
    [string]$Gcloud = 'gcloud'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if (-not (Get-Command $Gcloud -ErrorAction SilentlyContinue)) {
    $bundledCli = Join-Path $repoRoot '.local\gcloud\google-cloud-sdk\bin\gcloud.cmd'
    if (Test-Path -LiteralPath $bundledCli) { $Gcloud = $bundledCli } else { throw 'Install the Google Cloud CLI first: https://cloud.google.com/sdk/docs/install' }
}
function Invoke-Gcloud { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments) & $Gcloud @Arguments; if ($LASTEXITCODE -ne 0) { throw "gcloud command failed: $($Arguments[0..1] -join ' ')" } }
function Test-GcloudResource { param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments) & $Gcloud @Arguments --quiet 2>$null | Out-Null; return $LASTEXITCODE -eq 0 }
$account = & $Gcloud auth list '--filter=status:ACTIVE' '--format=value(account)'
if (-not $account) { throw 'Sign in first with gcloud auth login, using the account assigned to this project.' }
Invoke-Gcloud @('projects','describe',$ProjectId,'--format=value(projectId)')
Write-Host "Deploying WeLikeTrains to project $ProjectId ($Region). Runtime scales to zero and is capped at two instances."
Invoke-Gcloud @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','secretmanager.googleapis.com','aiplatform.googleapis.com','texttospeech.googleapis.com','firestore.googleapis.com','cloudscheduler.googleapis.com','--project',$ProjectId,'--quiet')
$runtime = "weliketrains-runtime@$ProjectId.iam.gserviceaccount.com"
$builder = "weliketrains-builder@$ProjectId.iam.gserviceaccount.com"
$scheduler = "weliketrains-scheduler@$ProjectId.iam.gserviceaccount.com"
foreach ($id in @('weliketrains-runtime','weliketrains-builder','weliketrains-scheduler')) {
    $email = "$id@$ProjectId.iam.gserviceaccount.com"
    if (-not (Test-GcloudResource @('iam','service-accounts','describe',$email,'--project',$ProjectId))) { Invoke-Gcloud @('iam','service-accounts','create',$id,'--project',$ProjectId,'--display-name',$id,'--quiet') }
}
foreach ($role in @('roles/aiplatform.user','roles/serviceusage.serviceUsageConsumer')) { Invoke-Gcloud @('projects','add-iam-policy-binding',$ProjectId,'--member',"serviceAccount:$runtime",'--role',$role,'--condition=None','--quiet') }
Invoke-Gcloud @('projects','add-iam-policy-binding',$ProjectId,'--member',"serviceAccount:$builder",'--role','roles/run.builder','--condition=None','--quiet')
if ($EnableReminders) {
    Invoke-Gcloud @('projects','add-iam-policy-binding',$ProjectId,'--member',"serviceAccount:$runtime",'--role','roles/datastore.user','--condition=None','--quiet')
    if (-not (Test-GcloudResource @('firestore','databases','describe','--database=(default)','--project',$ProjectId))) { Invoke-Gcloud @('firestore','databases','create','--database=(default)','--location',$Region,'--type=firestore-native','--project',$ProjectId,'--quiet') }
    Invoke-Gcloud @('firestore','fields','ttls','update','expiresAt','--collection-group=routines','--enable-ttl','--project',$ProjectId,'--quiet')
}
# Parse dotenv with its actual parser, never echo values to the terminal.
$envJson = & node --input-type=module -e 'import fs from "node:fs";import dotenv from "dotenv";console.log(JSON.stringify(fs.existsSync(".env")?dotenv.parse(fs.readFileSync(".env")):{}));'
$values = $envJson | ConvertFrom-Json -AsHashtable
if ($EnableReminders -and (-not $values.VAPID_PUBLIC_KEY -or -not $values.VAPID_PRIVATE_KEY)) {
    $vapidFile = Join-Path $repoRoot '.local\vapid.json'
    if (Test-Path -LiteralPath $vapidFile) { $vapid = Get-Content -LiteralPath $vapidFile -Raw | ConvertFrom-Json }
    else {
        $vapid = (& node --input-type=module -e 'import webpush from "web-push";console.log(JSON.stringify(webpush.generateVAPIDKeys()));') | ConvertFrom-Json
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $vapidFile) | Out-Null
        [System.IO.File]::WriteAllText($vapidFile, ($vapid | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    }
    $values.VAPID_PUBLIC_KEY = $vapid.publicKey
    $values.VAPID_PRIVATE_KEY = $vapid.privateKey
}
$secretKeys = @('LTA_ACCOUNT_KEY','ONEMAP_EMAIL','ONEMAP_PASSWORD','ONEMAP_TOKEN','VERTEX_API_KEY','VAPID_PRIVATE_KEY')
$secretBindings = @()
$privateDir = Join-Path $repoRoot '.local\deploy'
New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
foreach ($key in $secretKeys) {
    if (-not $values[$key]) { continue }
    $secret = 'weliketrains-' + $key.ToLower().Replace('_','-')
    if (-not (Test-GcloudResource @('secrets','describe',$secret,'--project',$ProjectId))) { Invoke-Gcloud @('secrets','create',$secret,'--replication-policy=automatic','--project',$ProjectId,'--quiet') }
    $secretFile = Join-Path $privateDir $key
    try {
        [System.IO.File]::WriteAllText($secretFile, $values[$key], [System.Text.UTF8Encoding]::new($false))
        Invoke-Gcloud @('secrets','versions','add',$secret,'--data-file',$secretFile,'--project',$ProjectId,'--quiet')
    } finally { if (Test-Path -LiteralPath $secretFile) { Remove-Item -LiteralPath $secretFile } }
    Invoke-Gcloud @('secrets','add-iam-policy-binding',$secret,'--member',"serviceAccount:$runtime",'--role','roles/secretmanager.secretAccessor','--project',$ProjectId,'--quiet')
    $secretBindings += "$key=${secret}:latest"
}
$publicEnv = @{
    NODE_ENV='production'; DATA_MODE='demo'; GOOGLE_CLOUD_PROJECT=$ProjectId; GOOGLE_CLOUD_LOCATION='global';
    GEMINI_MODEL=$(if ($values.GEMINI_MODEL) { $values.GEMINI_MODEL } else { 'gemini-2.5-flash' });
    ENABLE_CLOUD_TTS='true'; FIRESTORE_ENABLED=$(if ($EnableReminders) { 'true' } else { 'false' });
    VAPID_PUBLIC_KEY=$(if ($values.VAPID_PUBLIC_KEY) { $values.VAPID_PUBLIC_KEY } else { '' });
    VAPID_SUBJECT=$(if ($values.VAPID_SUBJECT) { $values.VAPID_SUBJECT } else { 'https://github.com/AirrowSST/WeLikeTrains' });
    SCHEDULER_SERVICE_ACCOUNT=$scheduler
}
$envFile = Join-Path $privateDir 'runtime-env.yaml'
[System.IO.File]::WriteAllText($envFile, ($publicEnv | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
$deployArgs = @('run','deploy','weliketrains','--source','.', '--project',$ProjectId,'--region',$Region,'--service-account',$runtime,'--build-service-account',"projects/$ProjectId/serviceAccounts/$builder",'--allow-unauthenticated','--memory=1Gi','--cpu=1','--min=0','--max=2','--concurrency=8','--timeout=120','--env-vars-file',$envFile,'--quiet')
if ($secretBindings.Count) { $deployArgs += @('--set-secrets',($secretBindings -join ',')) }
Invoke-Gcloud $deployArgs
$url = (& $Gcloud run services describe weliketrains '--format=value(status.url)' --region $Region --project $ProjectId).Trim()
Invoke-Gcloud @('run','services','update','weliketrains','--region',$Region,'--project',$ProjectId,'--update-env-vars',"PUBLIC_URL=$url,SCHEDULER_AUDIENCE=$url",'--quiet')
if ($EnableReminders) {
    $jobArgs = @('scheduler','jobs','create','http','weliketrains-reminders','--location',$Region,'--project',$ProjectId,'--schedule=*/5 * * * *','--time-zone=Asia/Singapore','--uri',"$url/api/internal/reminders",'--http-method=POST','--oidc-service-account-email',$scheduler,'--oidc-token-audience',$url,'--quiet')
    if (Test-GcloudResource @('scheduler','jobs','describe','weliketrains-reminders','--location',$Region,'--project',$ProjectId)) { $jobArgs[2] = 'update' }
    Invoke-Gcloud $jobArgs
}
$health = Invoke-RestMethod -Uri "$url/api/health"
if ($health.status -ne 'ok') { throw 'The deployed health check failed.' }
Write-Host "WeLikeTrains is running at $url"
