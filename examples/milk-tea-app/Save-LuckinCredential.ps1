param([switch]$FromStdin,[string]$OutputPath)
$ErrorActionPreference='Stop'
Import-Module "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security" -ErrorAction Stop
$target=if($OutputPath){$OutputPath}else{Join-Path $PSScriptRoot 'data\luckin-token.dpapi'}
New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
if($FromStdin){$secure=ConvertTo-SecureString -String ([Console]::In.ReadToEnd().Trim()) -AsPlainText -Force}
else{$secure=Read-Host '输入瑞幸 Bearer 令牌（不含 Bearer 前缀）' -AsSecureString}
$secure | ConvertFrom-SecureString | Set-Content -LiteralPath $target -Encoding ascii
# DPAPI binds this ciphertext to the current Windows user and machine.
Write-Output '瑞幸凭证已加密保存。重启网页服务后生效。'
