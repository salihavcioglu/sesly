param(
    [Parameter(Mandatory = $true)]
    [string]$MsiPath,
    [switch]$PrepareHostedRunner
)

$ErrorActionPreference = "Stop"
if ($PrepareHostedRunner -and ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted')) {
    throw 'Installer policy preparation is restricted to disposable GitHub-hosted runners'
}
$user = "SeslyMsiTest"
$password = 'Vs-' + [guid]::NewGuid().ToString('N') + '!'
$secure = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential("$env:COMPUTERNAME\$user", $secure)
$resolved = (Resolve-Path $MsiPath).Path
$createdUser = $false
$policyChanged = $false
$policyPath = 'SOFTWARE\Policies\Microsoft\Windows\Installer'
$policyKey = $null
$logDirectory = Join-Path $env:PUBLIC ('SeslyMsiSmoke-' + [guid]::NewGuid().ToString('N'))

try {
    New-Item -ItemType Directory -Path $logDirectory | Out-Null
    & icacls $logDirectory /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "test-log directory permissions exited $LASTEXITCODE" }
    if ($PrepareHostedRunner) {
        # Windows Server defaults to blocking unmanaged per-user MSIs. Prepare
        # only the disposable test host; the installer still runs without admin.
        $policyKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey($policyPath, $true)
        $hadPolicyKey = $null -ne $policyKey
        if (-not $hadPolicyKey) {
            $policyKey = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey($policyPath)
        }
        $hadDisableMsi = $policyKey.GetValueNames() -contains 'DisableMSI'
        if ($hadDisableMsi) {
            $oldDisableMsi = $policyKey.GetValue('DisableMSI', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            $oldDisableMsiKind = $policyKey.GetValueKind('DisableMSI')
        }
        $policyChanged = $true
        $policyKey.SetValue('DisableMSI', 0, [Microsoft.Win32.RegistryValueKind]::DWord)
    }
    New-LocalUser -Name $user -Password $secure | Out-Null
    $createdUser = $true
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $user
    $install = Start-Process msiexec.exe -Credential $credential -LoadUserProfile -Wait -PassThru -ArgumentList @(
        "/i", "`"$resolved`"", "/qn", "/norestart", "DISABLEWEBVIEW2BOOTSTRAP=1", "AUTOLAUNCHAPP=0",
        '/l*v', "`"$logDirectory\install.log`""
    )
    if ($install.ExitCode -ne 0) { throw "standard-user install exited $($install.ExitCode)" }

    $root = "C:\Users\$user\AppData\Local\Sesly (Current User)"
    if (-not (Test-Path "$root\sesly-dev.exe")) { throw "per-user shell missing at $root" }
    if (-not (Test-Path "$root\uv.exe")) { throw "per-user uv sidecar missing at $root" }

    $uninstall = Start-Process msiexec.exe -Credential $credential -LoadUserProfile -Wait -PassThru -ArgumentList @(
        "/x", "`"$resolved`"", "/qn", "/norestart", '/l*v', "`"$logDirectory\uninstall.log`""
    )
    if ($uninstall.ExitCode -ne 0) { throw "standard-user uninstall exited $($uninstall.ExitCode)" }
    if (Test-Path "$root\sesly-dev.exe") { throw "per-user shell remains after uninstall" }
}
catch {
    Get-ChildItem $logDirectory -Filter '*.log' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "--- $($_.Name) ---"
        Get-Content $_.FullName
    }
    throw
}
finally {
    try {
        if ($policyChanged) {
            if ($hadDisableMsi) { $policyKey.SetValue('DisableMSI', $oldDisableMsi, $oldDisableMsiKind) }
            else { $policyKey.DeleteValue('DisableMSI', $false) }
            $removeEmptyKey = -not $hadPolicyKey -and $policyKey.ValueCount -eq 0 -and $policyKey.SubKeyCount -eq 0
            $policyKey.Dispose()
            $policyKey = $null
            if ($removeEmptyKey) { [Microsoft.Win32.Registry]::LocalMachine.DeleteSubKey($policyPath, $false) }
        }
    }
    finally {
        if ($null -ne $policyKey) { $policyKey.Dispose() }
        if ($createdUser) { Remove-LocalUser -Name $user }
        Write-Host "Installer smoke logs: $logDirectory"
    }
}
