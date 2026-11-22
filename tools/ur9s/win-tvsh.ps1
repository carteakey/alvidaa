<#
    win-tvsh.ps1 — operator side of the 65UR9S root channel (Windows twin of
    tools/tvsh.py).

    The TV runs the root shell service: the vendor Node runtime
    (/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix) executes
    /APPS/.re_sshd/rshell.js, which listens on 8008 and spawns a root shell
    per connection. This script connects, sends a command batch, and prints
    what the shell answers.

    Usage:
        powershell -ExecutionPolicy Bypass -File tools/ur9s/win-tvsh.ps1 -Cmd "id"
        powershell -ExecutionPolicy Bypass -File tools/ur9s/win-tvsh.ps1 `
            -Cmd "grep -E '^(Uid|CapEff):' /proc/self/status" -Host <tv>
        powershell -ExecutionPolicy Bypass -File tools/ur9s/win-tvsh.ps1 -File batch.sh

    The shell is fed on stdin and terminated with `exit`, exactly like the
    Python client: the answer ends when the server closes the socket.
#>
param(
    [string]$Cmd,
    [string]$File,
    [string]$Host_ = '<tv>',
    [int]$Port = 8008,
    [int]$Timeout = 30
)

$ErrorActionPreference = 'Stop'
if (-not $Host_) { $Host_ = '<tv>' }

if ($File) { $batch = (Get-Content -LiteralPath $File -Raw) }
elseif ($Cmd) { $batch = $Cmd }
else { $batch = [Console]::In.ReadToEnd() }

if (-not $batch.Trim()) { Write-Error 'empty command'; exit 2 }
$batch = $batch.TrimEnd("`r", "`n") + "`nexit`n"

$client = New-Object System.Net.Sockets.TcpClient
try {
    $client.Connect($Host_, $Port)
} catch {
    Write-Error "cannot reach $Host_`:$Port -> $($_.Exception.Message)"
    exit 1
}
$client.ReceiveTimeout = $Timeout * 1000
$client.SendTimeout = $Timeout * 1000
$stream = $client.GetStream()

$bytes = [System.Text.Encoding]::UTF8.GetBytes($batch)
$stream.Write($bytes, 0, $bytes.Length)
$stream.Flush()

$out = New-Object System.Text.StringBuilder
$buf = New-Object byte[] 65536
try {
    while ($true) {
        $n = $stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { break }
        [void]$out.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $n))
    }
} catch {
    [void]$out.Append("`n[read ended: $($_.Exception.Message)]")
}
$client.Close()
Write-Host $out.ToString()
