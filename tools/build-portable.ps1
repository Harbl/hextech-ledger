# Builds dist\Hextech-Ledger-Portable-Windows.zip: the app plus the official
# Node.js runtime, so a shop PC needs nothing installed.
#   powershell -ExecutionPolicy Bypass -File tools\build-portable.ps1 [-NodeVersion v26.13.0]
# Bump NodeVersion (and the version in SECURITY.md) whenever Node ships a
# security release -- serve.js refuses to run on a Node with known holes.
param([string]$NodeVersion = 'v26.13.0')
$ErrorActionPreference = 'Stop'

$root  = Split-Path $PSScriptRoot
$dist  = Join-Path $root 'dist'
$stage = Join-Path $dist 'Hextech Ledger'
$name  = "node-$NodeVersion-win-x64"
$zip   = Join-Path $dist "$name.zip"
New-Item -ItemType Directory -Force $dist | Out-Null

# Fetch Node.js once, and refuse it unless it matches nodejs.org's published
# checksum and carries a valid Authenticode signature.
if (-not (Test-Path $zip)) {
  Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$name.zip" -OutFile $zip -UseBasicParsing
}
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
$want = ($sums -split "`n" | Where-Object { $_ -match " $name\.zip$" }) -replace '\s.*'
$got  = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if (-not $want -or $want -ne $got) { Remove-Item $zip; throw "Checksum mismatch for $name.zip" }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\node", "$stage\data", "$stage\tools" | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
foreach ($f in 'node.exe', 'LICENSE') {
  $e = $z.Entries | Where-Object FullName -eq "$name/$f"
  [IO.Compression.ZipFileExtensions]::ExtractToFile($e, "$stage\node\$f")
}
$z.Dispose()
$sig = Get-AuthenticodeSignature "$stage\node\node.exe"
if ($sig.Status -ne 'Valid') { throw "node.exe signature is $($sig.Status)" }

# The app itself -- no tests, Worker, Mac launcher or dev tools.
foreach ($f in 'index.html', 'app.js', 'app.css', 'sw.js', 'manifest.webmanifest', 'icon.svg',
               'SECURITY.md', 'Hextech Ledger (Windows).bat') { Copy-Item "$root\$f" $stage }
Copy-Item "$root\data\legends.json" "$stage\data"
Copy-Item "$root\tools\serve.js" "$stage\tools"
@"
Hextech Ledger - portable for Windows

Double-click "Hextech Ledger (Windows).bat". Nothing to install.
Closing the black window stops the app.

What it does and doesn't do with data: see SECURITY.md (opens in Notepad).
"@ | Set-Content "$stage\READ ME FIRST.txt" -Encoding utf8

$out = Join-Path $dist 'Hextech-Ledger-Portable-Windows.zip'
if (Test-Path $out) { Remove-Item $out }
Compress-Archive -Path $stage -DestinationPath $out
"Built $out  (Node $NodeVersion, signed by $($sig.SignerCertificate.Subject -replace '^CN=([^,]+).*','$1'))"

# The Mac needs no runtime bundled -- the launcher uses the Perl macOS ships.
# git archive, not Compress-Archive: it keeps the launcher's executable bit,
# without which macOS refuses to run it. Built from the last commit.
$mac = Join-Path $dist 'Hextech-Ledger-Portable-Mac.zip'
git -C $root archive --format=zip --prefix='Hextech Ledger/' -o $mac HEAD `
  index.html app.js app.css sw.js manifest.webmanifest icon.svg SECURITY.md `
  data/legends.json tools/serve.pl tools/serve.js 'Hextech Ledger (macOS).command'
if ($LASTEXITCODE) { throw 'git archive failed' }
"Built $mac  (from commit $(git -C $root rev-parse --short HEAD))"
