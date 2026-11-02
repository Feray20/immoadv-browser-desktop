// Altes automatisch entfernen (Feray 02.11.2026: „sobald das Update installiert wird, soll alles Alte entfernt werden –
// von alleine“; „da sind irgendwie zwei Browser installiert“). Läuft unter Windows einmal je Version beim ersten Start
// der neuen Version, still im Hintergrund. Entfernt nur Verweise, nie Profil, Passwörter, Lesezeichen oder Downloads:
//  • Verknüpfungen (Schreibtisch, Startmenü, Taskleiste), die auf den Motor (firefox.exe) oder ins Leere zeigen
//  • alte Installationen des ImmoAdv Browsers an einem anderen Ort (still deinstalliert) und leere Einträge in „Apps“
// Die eine richtige Verknüpfung (Startprogramm mit Kennung de.immoadv.browser.desktop) bleibt.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function script({ exe, inst, motor, log }) {
  return `$ErrorActionPreference = 'SilentlyContinue'
$exe = ${psq(exe)}; $inst = ${psq(inst)}; $motor = ${psq(motor)}; $log = ${psq(log)}
function L($m) { Add-Content -LiteralPath $log -Value ("{0} Aufräumen: {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'), $m) }
$sh = New-Object -ComObject WScript.Shell
$orte = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\StartMenu')
)
foreach ($o in $orte) {
  if (-not (Test-Path -LiteralPath $o)) { continue }
  Get-ChildItem -LiteralPath $o -Filter *.lnk -Recurse -Depth 2 | ForEach-Object {
    $lnk = $_.FullName; $t = ''
    try { $t = $sh.CreateShortcut($lnk).TargetPath } catch { return }
    if (-not $t) { return }
    $zumMotor = $t.StartsWith($motor + '\\', [StringComparison]::OrdinalIgnoreCase)
    $immo = ($_.BaseName -like '*ImmoAdv Browser*') -or ($t -like '*ImmoAdv Browser*')
    $tot = $immo -and -not (Test-Path -LiteralPath $t)
    $fremd = $immo -and ($t -like '*.exe') -and -not $t.Equals($exe, [StringComparison]::OrdinalIgnoreCase) -and -not $zumMotor -and -not $t.StartsWith($inst + '\\', [StringComparison]::OrdinalIgnoreCase)
    if ($zumMotor -or $tot -or $fremd) { Remove-Item -LiteralPath $lnk -Force; L ('Verknüpfung entfernt: ' + $lnk + ' -> ' + $t) }
  }
}
# Alte Installationen an anderem Ort und verwaiste Einträge unter „Apps“
foreach ($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    $p = Get-ItemProperty -LiteralPath $_.PSPath
    if ($p.DisplayName -notlike 'ImmoAdv Browser*') { return }
    $ort = [string]$p.InstallLocation
    if (-not $ort -and $p.DisplayIcon) { $ort = Split-Path ([string]$p.DisplayIcon).Split(',')[0].Trim('"') }
    if ($ort -and $ort.TrimEnd('\\').Equals($inst.TrimEnd('\\'), [StringComparison]::OrdinalIgnoreCase)) { return }
    if ($ort -and (Test-Path -LiteralPath $ort)) {
      $u = [string]$p.QuietUninstallString; if (-not $u) { $u = [string]$p.UninstallString; if ($u) { $u = $u + ' /S' } }
      if ($u) { L ('alte Installation wird entfernt: ' + $ort); Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $u -WindowStyle Hidden -Wait }
    } elseif ($_.PSPath -like '*HKEY_CURRENT_USER*') { Remove-Item -LiteralPath $_.PSPath -Recurse -Force; L ('leerer Eintrag in Apps entfernt: ' + $p.DisplayName) }
  }
}
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force
`;
}

function run(store, log) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const v = app.getVersion();
  try { if (store.get('cleanupDone') === v) return; } catch { /* egal */ }
  let motor = '';
  try { motor = require('./engine').paths.engine(); } catch { motor = path.join(app.getPath('userData'), 'Motor'); }
  const file = path.join(app.getPath('temp'), `immoadv-aufraeumen-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(file, '﻿' + script({ exe: app.getPath('exe'), inst: path.dirname(app.getPath('exe')), motor, log: path.join(app.getPath('userData'), 'update.log') }), 'utf8');
    const ch = require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file], { detached: true, stdio: 'ignore', windowsHide: true });
    ch.on('error', (e) => log('Aufräumen nicht gestartet: ' + e.message));
    ch.unref();
    try { store.setQuiet('cleanupDone', v); } catch { /* egal */ }
  } catch (e) { log('Aufräumen: ' + e.message); }
}

module.exports = { run, script };
