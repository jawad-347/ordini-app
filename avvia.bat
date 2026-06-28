@echo off
echo Avvio App Ordini Fresh Tropical...
echo.
cd /d "%~dp0"
node -v >nul 2>&1
if errorlevel 1 (
  echo ERRORE: Node.js non trovato.
  echo.
  echo Scarica e installa Node.js da: https://nodejs.org
  echo Scegli la versione LTS, poi riavvia questo file.
  echo.
  pause
  exit
)
if not exist node_modules (
  echo Prima installazione - scarico le dipendenze...
  npm install
  echo.
)
echo App pronta su http://localhost:3000
echo Premi CTRL+C per fermare il server.
echo.
node server.js
pause
