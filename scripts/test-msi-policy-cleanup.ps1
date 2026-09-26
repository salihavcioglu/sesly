# Windows PowerShell 5.1 regression: the disposable-host policy is restored on failure.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This regression requires a disposable GitHub-hosted runner'
}
$path = 'SOFTWARE\Policies\Microsoft\Windows\Installer'
$originalKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path, $true)
$hadKey = $null -ne $originalKey
$hadValue = $hadKey -and ($originalKey.GetValueNames() -contains 'DisableMSI')
if ($hadValue) {
    $originalValue = $originalKey.GetValue('DisableMSI', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $originalKind = $originalKey.GetValueKind('DisableMSI')
}
if ($hadKey -and ($originalKey.SubKeyCount -ne 0 -or @($originalKey.GetValueNames() | Where-Object { $_ -ne 'DisableMSI' }).Count -ne 0)) {
    $originalKey.Dispose()
    throw 'Refusing to alter a host with unrelated Installer policy'
}
if ($null -ne $originalKey) { $originalKey.Dispose() }
$invalid = Join-Path $env:PUBLIC ('invalid-msi-' + [guid]::NewGuid().ToString('N') + '.msi')
'Invalid MSI fixture' | Set-Content $invalid
try {
    foreach ($case in @('absent','dword','string')) {
        [Microsoft.Win32.Registry]::LocalMachine.DeleteSubKeyTree($path, $false)
        if ($case -ne 'absent') {
            $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($path)
            if ($case -eq 'string') { $key.SetValue('DisableMSI', '1', [Microsoft.Win32.RegistryValueKind]::String) }
            else { $key.SetValue('DisableMSI', 1, [Microsoft.Win32.RegistryValueKind]::DWord) }
            $key.Dispose()
        }
        $logsBefore = @(Get-ChildItem $env:PUBLIC -Directory -Filter 'SeslyMsiSmoke-*' | ForEach-Object FullName)
        $failure = $null
        try { & "$PSScriptRoot/smoke-per-user-msi.ps1" -MsiPath $invalid -PrepareHostedRunner }
        catch { $failure = $_.Exception.Message }
        if ($failure -notmatch 'standard-user install exited 1620') { throw "Unexpected invalid-MSI result: $failure" }
        $key = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($path)
        if ($case -eq 'absent') {
            if ($null -ne $key) { $key.Dispose(); throw 'Absent policy key was not restored' }
        } else {
            if ($null -eq $key) { throw 'Original policy key missing' }
            $expectedKind = if ($case -eq 'string') { [Microsoft.Win32.RegistryValueKind]::String } else { [Microsoft.Win32.RegistryValueKind]::DWord }
            $valid = $key.GetValueKind('DisableMSI') -eq $expectedKind -and $key.GetValue('DisableMSI').ToString() -eq '1'
            $key.Dispose()
            if (-not $valid) { throw 'Policy value/type changed after failure' }
        }
        if (Get-LocalUser -Name SeslyMsiTest -ErrorAction SilentlyContinue) { throw 'Test account survived failed install' }
        $newLogs = @(Get-ChildItem $env:PUBLIC -Directory -Filter 'SeslyMsiSmoke-*' | Where-Object { $_.FullName -notin $logsBefore })
        if ($newLogs.Count -ne 1 -or -not (Test-Path (Join-Path $newLogs[0].FullName 'install.log'))) { throw 'Verbose failure log missing' }
        Write-Host "PASS policy restoration after invalid MSI: $case"
    }
} finally {
    [Microsoft.Win32.Registry]::LocalMachine.DeleteSubKeyTree($path, $false)
    if ($hadKey) {
        $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($path)
        if ($hadValue) { $key.SetValue('DisableMSI', $originalValue, $originalKind) }
        $key.Dispose()
    }
    Remove-Item $invalid -ErrorAction SilentlyContinue
}
