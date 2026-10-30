# Exporteert de BoneInfo Access-tabellen naar CSV (data/csv/), als basis voor
# scripts/boneinfo_to_rdf.py. Vereist de 32-bit "Microsoft.Jet.OLEDB.4.0"-
# provider (ingebouwd in Windows) -- draai dit daarom met 32-bit PowerShell:
#   C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File scripts\export_tables.ps1
# Download BoneInfo_V01_10.mdb zelf van www.archeologieinnederland.nl (niet in
# deze repo, zie README.md).
param(
  [string]$DbPath = "$PSScriptRoot\..\BoneInfo_V01_10.mdb",
  [string]$OutDir = "$PSScriptRoot\..\data\csv"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Microsoft.Jet.OLEDB.4.0;Data Source=$DbPath;")

function Escape-Csv($val) {
  if ($null -eq $val) { return "" }
  $s = [string]$val
  $s = $s -replace '"', '""'
  return '"' + $s + '"'
}

function Export-Table($sql, $outFile) {
  $rs = New-Object -ComObject ADODB.Recordset
  $rs.Open($sql, $conn)
  $sw = New-Object System.IO.StreamWriter($outFile, $false, [System.Text.Encoding]::UTF8)
  $headers = @()
  foreach ($f in $rs.Fields) { $headers += Escape-Csv($f.Name) }
  $sw.WriteLine(($headers -join ","))
  $n = 0
  while (-not $rs.EOF) {
    $vals = @()
    foreach ($f in $rs.Fields) { $vals += Escape-Csv($f.Value) }
    $sw.WriteLine(($vals -join ","))
    $rs.MoveNext()
    $n++
  }
  $sw.Close()
  $rs.Close()
  Write-Output "$outFile : $n rows"
}

Export-Table "SELECT * FROM tblZoo_cluster" (Join-Path $OutDir "tblZoo_cluster.csv")
Export-Table "SELECT * FROM tblDiersoort" (Join-Path $OutDir "tblDiersoort.csv")
Export-Table "SELECT * FROM tblZoo_diersoort" (Join-Path $OutDir "tblZoo_diersoort.csv")
Export-Table "SELECT * FROM tblZoo_publicatie" (Join-Path $OutDir "tblZoo_publicatie.csv")
Export-Table "SELECT * FROM tblPeriodiek" (Join-Path $OutDir "tblPeriodiek.csv")
Export-Table "SELECT * FROM tblPeriode" (Join-Path $OutDir "tblPeriode.csv")
Export-Table "SELECT * FROM tblOmvang" (Join-Path $OutDir "tblOmvang.csv")

$conn.Close()
