@echo off
setlocal enableextensions
cd /d "%~dp0"

:: ===== Einstellungen =====
set "PORT=8001"
set "VENV_DIR=.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "VENV_CFG=%VENV_DIR%\pyvenv.cfg"

echo === Projekt: %CD%
echo === Port:    %PORT%

:: ===== Python finden (py bevorzugt, sonst python) =====
set "PY=py -3"
py -3 -V >nul 2>&1 || set "PY=python"

:: aktuelles Python-Home (um Interpreter-Wechsel zu erkennen)
for /f "delims=" %%H in ('%PY% -c "import sys,os;print(os.path.dirname(sys.executable))"') do set "CUR_PY_HOME=%%H"
if not defined CUR_PY_HOME (
  echo [FEHLER] Konnte Python nicht ermitteln. Ist Python installiert?
  start "" https://www.python.org/downloads/
  exit /b 1
)

:: ===== venv nur bei Bedarf neu bauen =====
set "NEED_REBUILD="
if not exist "%VENV_PY%" (
  set "NEED_REBUILD=1"
) else (
  for /f "tokens=1,* delims==" %%A in (%VENV_CFG%) do if /i "%%A"=="home" set "VENV_HOME=%%B"
  if /i "%VENV_HOME%" NEQ "%CUR_PY_HOME%" set "NEED_REBUILD=1"
)

if defined NEED_REBUILD (
  echo === Baue virtuelle Umgebung neu ...
  rmdir /s /q "%VENV_DIR%" 2>nul
  %PY% -m venv "%VENV_DIR%" || (echo [FEHLER] venv fehlgeschlagen & exit /b 1)
) else (
  echo === Verwende bestehende virtuelle Umgebung.
)

:: ===== Requirements idempotent installieren =====
if exist requirements.txt (
  "%VENV_PY%" -m pip install -r requirements.txt --disable-pip-version-check || (
    echo [FEHLER] Installation aus requirements.txt fehlgeschlagen.
    exit /b 1
  )
)

:: ===== Server in EIGENEM Fenster starten (bleibt offen) =====
set "FLASK_RUN_PORT=%PORT%"
start "ProjectSearch Server" cmd /c ""%VENV_PY%" app.py"

:: ===== Auf Server warten und Browser öffnen =====
powershell -NoProfile -Command ^
  "$p=%PORT%; $ok=$false; for($i=0;$i -lt 60;$i++){try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',$p);$ok=$c.Connected;$c.Close()}catch{} if($ok){break}; Start-Sleep -Milliseconds 250}; if($ok){Start-Process ('http://127.0.0.1:'+$p+'/')}"

:: ===== Startfenster jetzt schließen, Serverfenster bleibt offen =====
endlocal
exit /b 0
