@echo off
rem Starts a small local web server for the map and opens it in your browser.
rem Close this window to stop the server.
cd /d "%~dp0"
echo Neighborhood explorer is running at http://localhost:8765
echo Close this window to stop it.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8765/?v=4"
python serve.py 8765
