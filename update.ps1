# The existing ETF-Finder-Daily task calls this after publishing its snapshot.
$ErrorActionPreference = "Stop"
$repository = "https://github.com/inandout-kr/etf-finder-share.git"
$publish = Join-Path $PSScriptRoot ".deploy"
$safePublish = $publish.Replace('\', '/')

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Invoke-PublishGit {
    param([string[]]$Arguments)
    Invoke-Checked "git" (@("-c", "safe.directory=$safePublish", "-C", $publish) + $Arguments)
}

Push-Location $PSScriptRoot
try {
    $nodeDirectory = Join-Path $env:ProgramFiles "nodejs"
    $env:Path = "$nodeDirectory;$env:Path"
    if (!(Test-Path -LiteralPath "node_modules/vite/package.json")) {
        Invoke-Checked "npm.cmd" @("ci", "--no-audit", "--no-fund")
    }
    Invoke-Checked "npm.cmd" @("run", "sync:data")
    Invoke-Checked "npm.cmd" @("test")
    Invoke-Checked "npm.cmd" @("run", "build")

    if (!(Test-Path -LiteralPath $publish)) {
        Invoke-Checked "git" @("clone", "--branch", "gh-pages", "--single-branch", $repository, $publish)
    }
    $remote = Invoke-PublishGit @("remote", "get-url", "origin")
    if ($remote.Trim() -ne $repository) { throw "Unexpected publishing repository: $remote" }
    $branch = Invoke-PublishGit @("branch", "--show-current")
    if ($branch.Trim() -ne "gh-pages") { throw "Publishing checkout must use gh-pages." }
    $changes = Invoke-PublishGit @("status", "--porcelain")
    if ($changes) { throw "Publishing checkout has local changes; leaving it untouched." }
    Invoke-PublishGit @("pull", "--ff-only", "origin", "gh-pages")

    # Copy only the public build. Keep the publishing checkout and older assets intact.
    Get-ChildItem -LiteralPath "dist" -Force | Copy-Item -Destination $publish -Recurse -Force
    if (!(Test-Path -LiteralPath (Join-Path $publish ".nojekyll"))) {
        New-Item -ItemType File -Path (Join-Path $publish ".nojekyll") | Out-Null
    }
    Invoke-PublishGit @("add", "--all")
    & git -c "safe.directory=$safePublish" -C $publish diff --cached --quiet
    $diffExit = $LASTEXITCODE
    if ($diffExit -eq 0) {
        Write-Host "No changes in the public build."
    } elseif ($diffExit -eq 1) {
        $meta = Get-Content -LiteralPath "dist/data/meta.json" -Raw | ConvertFrom-Json
        Invoke-PublishGit @("commit", "-m", "Update ETF snapshot $($meta.baseDate)")
    } else {
        throw "Could not compare the staged public build: $diffExit"
    }
    # Also retry a commit left unpushed by a previous network failure.
    Invoke-PublishGit @("push", "origin", "gh-pages")
    Write-Host "Shared ETF site is up to date."
    $global:LASTEXITCODE = 0
} finally {
    Pop-Location
}
