<#
    server.ps1 — Windows twin of tools/ur9s/web/server.py

    LAN-only static server for the VIDAA root chain. Serves the pages and the
    artifacts under pub/, and stores whatever the TV POSTs back under
    captures/. No external domains, no TLS, no auth — trusted LAN only.

        powershell -ExecutionPolicy Bypass -File tools/ur9s/web/server.ps1 [-Port 9000]

    Routes
        GET  /                 -> install.html
        GET  /install.html     -> install.html
        GET  /trigger.html     -> trigger.html
        GET  /recon.html       -> pub/recon.html
        GET  /pub/<name>       -> pub/<name>
        POST /recon            -> captures/run-<timestamp>-<seq>.txt
        POST /api/recon        -> same
#>
param(
    [int]$Port = 9000,
    [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$ErrorActionPreference = 'Stop'
$Cap = Join-Path $Root 'captures'
$Pub = Join-Path $Root 'pub'
if (-not (Test-Path $Cap)) { New-Item -ItemType Directory -Path $Cap | Out-Null }
if (-not (Test-Path $Pub)) { New-Item -ItemType Directory -Path $Pub | Out-Null }

$script:Seq = 0
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)

function Send-Response {
    param($Stream, [int]$Code, [byte[]]$Body, [string]$ContentType, [bool]$HeadOnly = $false)
    $reason = switch ($Code) {
        200 { 'OK' } 404 { 'Not Found' } 405 { 'Method Not Allowed' } default { 'OK' }
    }
    $head = "HTTP/1.1 $Code $reason`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "Access-Control-Allow-Origin: *`r`n" +
            "Connection: close`r`n`r`n"
    $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)
    $Stream.Write($headBytes, 0, $headBytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Read-Request {
    param($Stream)
    $buf = New-Object System.Collections.Generic.List[byte]
    $one = New-Object byte[] 1
    $state = 0
    while ($buf.Count -lt 65536) {
        $n = $Stream.Read($one, 0, 1)
        if ($n -le 0) { break }
        $buf.Add($one[0])
        $c = $buf.Count
        if ($c -ge 4 -and $buf[$c - 4] -eq 13 -and $buf[$c - 3] -eq 10 -and
            $buf[$c - 2] -eq 13 -and $buf[$c - 1] -eq 10) { $state = 1; break }
    }
    if ($buf.Count -eq 0) { return $null }
    $raw = [System.Text.Encoding]::ASCII.GetString($buf.ToArray())
    $parts = $raw -split "`r`n"
    $requestLine = $parts[0]
    $headers = @{}
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $line = $parts[$i]
        if ($line -eq '') { continue }
        $idx = $line.IndexOf(':')
        if ($idx -lt 1) { continue }
        $headers[$line.Substring(0, $idx).Trim().ToLower()] = $line.Substring($idx + 1).Trim()
    }
    $body = New-Object byte[] 0
    if ($headers.ContainsKey('content-length')) {
        $len = [int]$headers['content-length']
        if ($len -gt 0) {
            $body = New-Object byte[] $len
            $read = 0
            while ($read -lt $len) {
                $r = $Stream.Read($body, $read, $len - $read)
                if ($r -le 0) { break }
                $read += $r
            }
        }
    }
    return [pscustomobject]@{ RequestLine = $requestLine; Headers = $headers; Body = $body }
}

function Get-FileBytes {
    param([string]$Path)
    try {
        if (Test-Path -LiteralPath $Path -PathType Leaf) { return [System.IO.File]::ReadAllBytes($Path) }
    } catch { }
    return $null
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
$listener.Start()
Write-Host "[*] serving on http://0.0.0.0:$Port/  (root: $Root  captures -> $Cap)"

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $req = Read-Request -Stream $stream
        if ($null -eq $req) { $client.Close(); continue }

        $bits = $req.RequestLine -split ' '
        $method = if ($bits.Count -ge 1) { $bits[0] } else { 'GET' }
        $target = if ($bits.Count -ge 2) { $bits[1] } else { '/' }
        $path = ($target -split '\?')[0]

        if ($method -eq 'GET' -or $method -eq 'HEAD') {
            $file = $null
            switch -Regex ($path) {
                '^/$'          { $file = Join-Path $Root 'install.html' }
                '^/install\.html$' { $file = Join-Path $Root 'install.html' }
                '^/trigger\.html$' { $file = Join-Path $Root 'trigger.html' }
                '^/recon\.html$'   { $file = Join-Path $Pub  'recon.html' }
                '^/pub/' {
                    $name = Split-Path -Leaf $path
                    if ($name -and $name -notmatch '^[A-Za-z0-9._-]+$') { break }
                    $file = Join-Path $Pub $name
                }
                '^/syntax/' {
                    # the local syntax gate (jsparse / jsbisect): parses a JS
                    # file the way the TV's Node does, before it is shipped
                    $name = Split-Path -Leaf $path
                    if ($name -and $name -notmatch '^[A-Za-z0-9._-]+$') { break }
                    $file = Join-Path $Root (Join-Path 'syntax' $name)
                }
            }
            $bytes = if ($file) { Get-FileBytes -Path $file } else { $null }
            if ($bytes) {
                $ctype = if ($file -like '*.html') { 'text/html; charset=utf-8' }
                         elseif ($file -like '*.js') { 'application/javascript; charset=utf-8' }
                         else { 'application/octet-stream' }
                Write-Host "[GET] $path -> $([System.IO.Path]::GetFileName($file)) ($($bytes.Length) bytes)"
                Send-Response -Stream $stream -Code 200 -Body $bytes -ContentType $ctype -HeadOnly ($method -eq 'HEAD')
            } else {
                Write-Host "[GET] $path -> 404"
                $b = $script:Utf8.GetBytes('not found')
                Send-Response -Stream $stream -Code 404 -Body $b -ContentType 'text/plain'
            }
        }
        elseif ($method -eq 'POST') {
            if ($path -eq '/recon' -or $path -eq '/api/recon') {
                $script:Seq++
                $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
                $p = Join-Path $Cap ("run-$ts-{0:d6}.txt" -f $script:Seq)
                [System.IO.File]::WriteAllBytes($p, $req.Body)
                Write-Host "[+] captured $($req.Body.Length) bytes -> $p"
                $b = $script:Utf8.GetBytes('ok')
                Send-Response -Stream $stream -Code 200 -Body $b -ContentType 'text/plain'
            } else {
                $b = $script:Utf8.GetBytes('not found')
                Send-Response -Stream $stream -Code 404 -Body $b -ContentType 'text/plain'
            }
        }
        else {
            $b = $script:Utf8.GetBytes('method not allowed')
            Send-Response -Stream $stream -Code 405 -Body $b -ContentType 'text/plain'
        }
        $client.Close()
    }
    catch {
        Write-Host "[!] $($_.Exception.Message)"
    }
}
