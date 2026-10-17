$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$exportRoot=Join-Path $projectRoot '.tools/source-export'
New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
$sourceFiles=@(Get-ChildItem -LiteralPath $projectRoot -File | Where-Object {$_.Extension -eq '.mjs' -or $_.Name -in @('package.json','package-lock.json','initial-content.json','Dockerfile','compose.yaml','compose.production.yaml','README.md','DEPLOY.md','SEO-REPORT.md','PERFORMANCE-REPORT.md','TELEGRAM-BOT.md','SECURITY-OPERATIONS.md','export-source.ps1')})
foreach($file in $sourceFiles){Copy-Item -LiteralPath $file.FullName -Destination $exportRoot}
foreach($folder in @('public','tests','scripts','telegram_bot')){
 $sourceFolder=Join-Path $projectRoot $folder
 foreach($file in Get-ChildItem -LiteralPath $sourceFolder -File -Recurse | Where-Object {($_.Extension -in @('.js','.css','.html','.mjs','.md','.py','.txt') -or $_.Name -eq 'Dockerfile') -and $_.FullName -notlike '*\assets\uploads\*' -and $_.FullName -notlike '*\telegram_bot\state\*'}){
  $relative=[IO.Path]::GetRelativePath($projectRoot,$file.FullName)
  $destination=Join-Path $exportRoot $relative
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination
 }
}
Compress-Archive -Path (Join-Path $exportRoot '*') -DestinationPath (Join-Path $projectRoot 'public/site-source.zip') -Force
