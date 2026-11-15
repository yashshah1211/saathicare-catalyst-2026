param(
  [Parameter(Mandatory)][string]$Project,
  [string]$Region = 'asia-south1',
  [string]$Service = 'saathicare',
  [string]$RuntimeAccount = "saathicare-runtime@$Project.iam.gserviceaccount.com",
  [string]$SchedulerAccount = "saathicare-scheduler@$Project.iam.gserviceaccount.com",
  [string]$EnvFile,
  [switch]$ConfigureScheduler
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$Repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$DeployArgs = @(
  'run', 'deploy', $Service, "--project=$Project", "--region=$Region", "--source=$Repo",
  "--service-account=$RuntimeAccount", '--no-invoker-iam-check', '--min-instances=0',
  '--max-instances=2', '--memory=512Mi', '--port=8080', '--timeout=180', '--quiet'
)
if ($EnvFile) { $DeployArgs += "--env-vars-file=$((Resolve-Path -LiteralPath $EnvFile).Path)" }
gcloud @DeployArgs

$Url = gcloud run services describe $Service "--project=$Project" "--region=$Region" '--format=value(status.url)'
if ($ConfigureScheduler) {
  $Audience = "$Url/api/internal/reminders"
  $Settings = "SCHEDULER_AUDIENCE=$Audience,SCHEDULER_SERVICE_ACCOUNT=$SchedulerAccount,APP_URL=$Url"
  gcloud run services update $Service "--project=$Project" "--region=$Region" "--update-env-vars=$Settings" --quiet
  $Job = "$Service-reminders"
  $Existing = gcloud scheduler jobs list "--project=$Project" "--location=$Region" "--filter=name:$Job" '--format=value(name)'
  $Action = if ($Existing) { 'update' } else { 'create' }
  gcloud scheduler jobs $Action http $Job "--project=$Project" "--location=$Region" --schedule='* * * * *' --time-zone=UTC `
    "--uri=$Audience" --http-method=POST "--oidc-service-account-email=$SchedulerAccount" "--oidc-token-audience=$Audience" --attempt-deadline=120s --quiet
}
$Health = Invoke-RestMethod -Uri "$Url/api/health"
if ($Health.status -ne 'ok') { throw 'Cloud Run health check failed.' }
Write-Output "Public service verified at $Url"
