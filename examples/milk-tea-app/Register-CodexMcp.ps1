$ErrorActionPreference = 'Stop'
$taskBun = Get-Command bun -ErrorAction SilentlyContinue
$taskBunPath = if ($taskBun) { $taskBun.Source } else { Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
if (-not (Test-Path -LiteralPath $taskBunPath)) { throw 'Please install Bun first.' }
$taskCodex = (Get-Command codex -ErrorAction Stop).Source
$taskServer = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'src\mcp.ts')).Path
$taskExisting = & $taskCodex mcp get ocp-milktea-local --json 2>$null
if ($LASTEXITCODE -eq 0) {
    $taskConfig = $taskExisting | ConvertFrom-Json
    if ($taskConfig.transport.command -ne $taskBunPath -or $taskConfig.transport.args[0] -ne $taskServer) {
        throw 'ocp-milktea-local already exists with a different configuration. Inspect before replacing.'
    }
    Write-Host 'ocp-milktea-local is already configured.'
    exit 0
}
& $taskCodex mcp add ocp-milktea-local -- $taskBunPath $taskServer
if ($LASTEXITCODE -ne 0) { throw 'MCP registration failed.' }
& $taskCodex mcp get ocp-milktea-local
