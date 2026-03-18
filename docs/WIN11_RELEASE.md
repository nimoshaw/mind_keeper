# Mind Keeper Win11 Release Guide

## Release Position

The first public release target is:

- Windows 11
- local-first usage
- one developer machine per project
- MCP server launched locally by the IDE or agent

Linux and macOS can follow later after the product shape is more stable.

## What Users Need

- Windows 11

Optional local toolchains for better symbol extraction:

- Python
- Go
- Rust / Cargo
- Java / javac

These toolchains improve language coverage but are not required to run the core MCP server.

For distribution there are now two supported Win11 tracks:

1. developer track: `npm`
2. end-user track: packaged `exe`
3. installer track: `Setup.exe`

The packaged `exe` track does not require the user to install Node.js first.

## Recommended First-Run Flow

### Developer Track

From PowerShell inside the project:

```powershell
Set-Location D:\projects\mind_keeper
powershell -ExecutionPolicy Bypass -File .\scripts\setup-win11.ps1
```

That will:

1. check Node.js version
2. install npm dependencies
3. build `dist/index.js`

### Packaged EXE Track

To build the portable Windows release from the repository:

```powershell
Set-Location D:\projects\mind_keeper
npm run package:win11
```

That produces:

```text
artifacts/win11/MindKeeper-win11-x64/
  mind-keeper.exe
  README.md
  WIN11_RELEASE.md
  release-manifest.json
  mcp-client-config.example.json
  app/
```

The `mind-keeper.exe` file is the launcher that IDE clients should call.
The `app/` folder stays beside it and contains the runtime payload plus production dependencies.

This layout is the current V1 release choice because it is more stable for native modules such as `better-sqlite3` than forcing a single opaque executable image.

### Setup.exe Installer Track

To build a normal Windows installer on a maintainer machine:

```powershell
Set-Location D:\projects\mind_keeper
npm run package:win11:installer
```

Requirements for this step:

- the portable package pipeline must be available
- `Inno Setup 6` must be installed
- `ISCC.exe` must be discoverable in `PATH`, or exposed through `ISCC_EXE`

Output location:

```text
artifacts/win11-installer/MindKeeperSetup-0.1.0-win11-x64.exe
```

If `Inno Setup 6` is missing, the script stops with a clear message and points back to the ready portable package.

## Starting The MCP Server On Win11

### Developer Track

For direct local launch:

```powershell
Set-Location D:\projects\mind_keeper
powershell -ExecutionPolicy Bypass -File .\scripts\start-win11.ps1
```

If the build output is already present, the script starts immediately.

### Packaged EXE Track

For the portable release build:

```powershell
Set-Location D:\projects\mind_keeper\artifacts\win11\MindKeeper-win11-x64
.\mind-keeper.exe
```

For a quick health check instead of a long-running MCP session:

```powershell
.\mind-keeper.exe --self-check
```

### Setup.exe Installer Track

After installing with `Setup.exe`, the default location is:

```text
C:\Program Files\Mind Keeper\
```

Important files after install:

- `C:\Program Files\Mind Keeper\mind-keeper.exe`
- `C:\Program Files\Mind Keeper\app\`
- `C:\Program Files\Mind Keeper\mcp-client-config.example.json`

The installer also creates Start Menu shortcuts for:

- `Mind Keeper`
- `Mind Keeper README`
- `Mind Keeper MCP Config Example`
- `Uninstall Mind Keeper`

## MCP Client Command

### Developer Track

If a client needs the raw command instead of the helper script:

```json
{
  "command": "node",
  "args": ["D:/projects/mind_keeper/dist/index.js"]
}
```

### Packaged EXE Track

If the client should use the packaged Windows release:

```json
{
  "command": "D:/projects/mind_keeper/artifacts/win11/MindKeeper-win11-x64/mind-keeper.exe"
}
```

### Setup.exe Installer Track

If the user installed through the Windows installer and kept the default path:

```json
{
  "command": "C:/Program Files/Mind Keeper/mind-keeper.exe"
}
```

If the client prefers a PowerShell wrapper:

```json
{
  "command": "powershell",
  "args": [
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "D:/projects/mind_keeper/scripts/start-win11.ps1"
  ]
}
```

## Why Win11 First Works Well

This product is light enough for local-first release:

- no mandatory central backend
- no multi-tenant data layer
- project memory stays inside `.mindkeeper`
- the MCP process can live beside the IDE

That means the easiest first release is a Windows-local deployment, not a Linux-hosted shared service.

## Release Checklist For Win11 First Release

Before shipping the first Windows build:

1. run `npm run verify`
2. run `npm run release:check`
3. run `npm run package:win11`
4. confirm `mind-keeper.exe --self-check` succeeds
5. optionally run `npm run package:win11:installer`
6. if installer packaging is used, confirm the installed app path launches cleanly
7. confirm the README matches the current MCP tool surface
8. confirm the Win11 PowerShell scripts start cleanly on a fresh machine
9. confirm one sample IDE MCP config can launch the server

## Scope Boundary

What this first release is:

- core MCP server for Windows 11
- local-first project memory engine
- stable MCP tool surface for future wrappers
- developer `npm` distribution
- end-user portable `exe` distribution
- optional Win11 `Setup.exe` installer distribution

What this first release is not yet:

- a finished VS Code extension
- a finished AntiGravity plugin
- a hosted SaaS memory platform
