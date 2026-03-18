#define AppName "Mind Keeper"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef SourceRoot
  #error SourceRoot define is required.
#endif

[Setup]
AppId={{3F1A1B98-80EA-4CF4-9D22-C2D4A66C3F15}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Mind Keeper
AppPublisherURL=https://github.com/nimoshaw/mind_keeper
DefaultDirName={autopf}\Mind Keeper
DefaultGroupName=Mind Keeper
UninstallDisplayIcon={app}\mind-keeper.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=MindKeeperSetup-{#AppVersion}-win11-x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceRoot}\mind-keeper.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\WIN11_RELEASE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\release-manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\mcp-client-config.example.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Mind Keeper"; Filename: "{app}\mind-keeper.exe"
Name: "{group}\Mind Keeper README"; Filename: "{app}\README.md"
Name: "{group}\Mind Keeper MCP Config Example"; Filename: "{app}\mcp-client-config.example.json"
Name: "{group}\Uninstall Mind Keeper"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Mind Keeper"; Filename: "{app}\mind-keeper.exe"; Tasks: desktopicon
