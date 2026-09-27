@echo off
:: Self-restarting supervisor keeper for MEGAPHONE.
:: If supervisor.ts exits for ANY reason, wait and relaunch — forever.
set NODE=C:\Users\ellio\AppData\Local\hermes\node\node.exe
set TSX=D:\megaphone\node_modules\tsx\dist\cli.mjs
set SCRIPT=D:\megaphone\src\supervisor.ts
set OUT=D:\megaphone\.daemon.out.log
set ERR=D:\megaphone\.daemon.err.log

:loop
echo [%date% %time%] runner: launching supervisor >> %OUT%
"%NODE%" "%TSX%" "%SCRIPT%" >> %OUT% 2>> %ERR%
echo [%date% %time%] runner: supervisor exited, restarting in 5s >> %OUT%
timeout /t 5 /nobreak >nul
goto loop
