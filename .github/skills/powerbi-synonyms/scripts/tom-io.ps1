<#
  tom-io.ps1 — read or write a semantic model's linguistic metadata through TOM.

  Deliberately thin. The merge rules live in merge-synonyms.js; this only moves
  the JSON document in and out of the model's en-US culture.

    -Mode read    write the current linguistic metadata JSON to -OutFile
    -Mode write   replace it with the JSON in -InFile, then SaveChanges()
    -Mode schema  write [{table, object}] for every table, column and measure

  -Server is "localhost:<port>" for Power BI Desktop, or an XMLA endpoint.
  Desktop hosts exactly one database, so -Database is optional there.

  TOM assemblies are found in -TomPath, $env:PBI_TOM_PATH, the NuGet cache
  (Microsoft.AnalysisServices.retail.amd64), or the SqlServer PowerShell module.

  The last line of output is always one line of JSON: {"ok":true,...} or
  {"ok":false,"error":"..."}. Runs on Windows PowerShell 5.1.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('read', 'write', 'schema')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Database,
  [string]$OutFile,
  [string]$InFile,
  [string]$BackupDir,
  [string]$TomPath = $env:PBI_TOM_PATH
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Emit($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 4) }
function Fail($msg) { Emit @{ ok = $false; error = "$msg" }; exit 1 }

function Find-TomFolder {
  $candidates = @()
  if ($TomPath) { $candidates += $TomPath }
  $nuget = Join-Path $env:USERPROFILE '.nuget\packages\microsoft.analysisservices.retail.amd64'
  if (Test-Path $nuget) {
    $candidates += Get-ChildItem $nuget -Directory |
      Sort-Object { try { [version]($_.Name -replace '-.*$', '') } catch { [version]'0.0' } } -Descending |
      ForEach-Object { Join-Path $_.FullName 'lib\net45' }
  }
  $mod = Get-Module -ListAvailable SqlServer | Sort-Object Version -Descending | Select-Object -First 1
  if ($mod) { $candidates += $mod.ModuleBase }
  foreach ($c in $candidates) {
    if (Test-Path (Join-Path $c 'Microsoft.AnalysisServices.Tabular.dll')) { return $c }
  }
  return $null
}

try {
  $dir = Find-TomFolder
  if (-not $dir) {
    Fail ("TOM assemblies not found. Install one of: " +
      "'nuget install Microsoft.AnalysisServices.retail.amd64' (then set PBI_TOM_PATH to its lib\net45 folder), " +
      "or 'Install-Module SqlServer -Scope CurrentUser'.")
  }
  # Load dependencies first; .NET Framework won't probe the DLL's own folder for them.
  foreach ($dll in 'Microsoft.AnalysisServices.Core.dll', 'Microsoft.AnalysisServices.dll',
                   'Microsoft.AnalysisServices.Tabular.Json.dll', 'Microsoft.AnalysisServices.Tabular.dll') {
    $p = Join-Path $dir $dll
    if (Test-Path $p) { Add-Type -Path $p }
  }

  $srv = New-Object Microsoft.AnalysisServices.Tabular.Server
  $srv.Connect("Data Source=$Server")

  if ($Database) {
    $db = $srv.Databases.FindByName($Database)
    if (-not $db) { $db = $srv.Databases.Find($Database) }
    if (-not $db) { Fail "database '$Database' not found on $Server" }
  } else {
    if ($srv.Databases.Count -ne 1) { Fail "$Server hosts $($srv.Databases.Count) databases; pass -Database" }
    $db = $srv.Databases[0]
  }
  $model = $db.Model

  switch ($Mode) {
    'read' {
      if (-not $OutFile) { Fail '-OutFile is required for read' }
      $culture = $model.Cultures.Find('en-US')
      $has = [bool]($culture -and $culture.LinguisticMetadata -and $culture.LinguisticMetadata.Content)
      if ($has) { [System.IO.File]::WriteAllText($OutFile, $culture.LinguisticMetadata.Content, $utf8) }
      Emit @{ ok = $true; database = $db.Name; hasMetadata = $has }
    }

    'schema' {
      if (-not $OutFile) { Fail '-OutFile is required for schema' }
      $list = New-Object System.Collections.ArrayList
      foreach ($t in $model.Tables) {
        [void]$list.Add(@{ table = $t.Name; object = $null })
        foreach ($c in $t.Columns) {
          if ("$($c.Type)" -ne 'RowNumber') { [void]$list.Add(@{ table = $t.Name; object = $c.Name }) }
        }
        foreach ($m in $t.Measures) { [void]$list.Add(@{ table = $t.Name; object = $m.Name }) }
      }
      [System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $list.ToArray() -Depth 3 -Compress), $utf8)
      Emit @{ ok = $true; database = $db.Name; objects = $list.Count }
    }

    'write' {
      if (-not $InFile) { Fail '-InFile is required for write' }
      $json = [System.IO.File]::ReadAllText($InFile, $utf8)

      $culture = $model.Cultures.Find('en-US')
      if (-not $culture) {
        $culture = New-Object Microsoft.AnalysisServices.Tabular.Culture
        $culture.Name = 'en-US'
        $model.Cultures.Add($culture)
      }

      # Back up whatever is there before replacing it.
      $backup = $null
      if ($BackupDir -and $culture.LinguisticMetadata -and $culture.LinguisticMetadata.Content) {
        [void](New-Item -ItemType Directory -Force -Path $BackupDir)
        $backup = Join-Path $BackupDir ("linguistic-metadata.{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
        [System.IO.File]::WriteAllText($backup, $culture.LinguisticMetadata.Content, $utf8)
      }

      if (-not $culture.LinguisticMetadata) {
        $lm = New-Object Microsoft.AnalysisServices.Tabular.LinguisticMetadata
        $lm.ContentType = [Microsoft.AnalysisServices.Tabular.ContentType]::Json
        $lm.Content = $json
        $culture.LinguisticMetadata = $lm
      } else {
        $culture.LinguisticMetadata.Content = $json
      }
      [void]$model.SaveChanges()
      Emit @{ ok = $true; database = $db.Name; backup = $backup }
    }
  }
  $srv.Disconnect()
} catch {
  Fail $_.Exception.Message
}
