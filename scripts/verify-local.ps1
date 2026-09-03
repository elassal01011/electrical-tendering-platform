$ErrorActionPreference = 'Stop'
# This creates and removes only a dedicated temporary verification container.
$verificationContainer = 'esolutions-verify-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$verificationPassword = [guid]::NewGuid().ToString('N')
$previousDatabase = $env:DATABASE_URL
$previousDirect = $env:DIRECT_URL
$previousVerify = $env:VERIFY_DATABASE
$created = $false
try {
  docker run --name $verificationContainer --label purpose=esolutions-verification -e POSTGRES_PASSWORD=$verificationPassword -e POSTGRES_DB=esolutions_verification -p 127.0.0.1:55439:5432 -d postgres:16-alpine
  if ($LASTEXITCODE -ne 0) { throw 'Could not start the verification database. Ensure Docker is running and local port 55439 is free.' }
  $created = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    docker exec $verificationContainer pg_isready -U postgres -d esolutions_verification | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (!$ready) { throw 'Verification database did not become ready.' }
  $env:DATABASE_URL = 'postgresql://postgres:' + $verificationPassword + '@127.0.0.1:55439/esolutions_verification'
  $env:DIRECT_URL = $env:DATABASE_URL
  $env:VERIFY_DATABASE = 'true'
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Migration verification failed.' }
  npx vitest run tests/integration
  if ($LASTEXITCODE -ne 0) { throw 'Workflow verification failed.' }
  npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma/schema.prisma --exit-code
  if ($LASTEXITCODE -ne 0) { throw 'Migration/schema drift detected.' }
} finally {
  $env:DATABASE_URL = $previousDatabase
  $env:DIRECT_URL = $previousDirect
  $env:VERIFY_DATABASE = $previousVerify
  if ($created -and $verificationContainer -match '^esolutions-verify-[a-f0-9]{8}$') { docker rm -f $verificationContainer | Out-Null }
}
