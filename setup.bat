@echo off
REM MEGAPHONE one-command setup — run on YOUR machine (residential IP passes Cloudflare).
REM Clones, installs, creates a pump.fun identity, and starts the daemon.
REM Needs: Node.js 18+ installed. Run from anywhere.
cd /d D:\
if not exist megaphone (
  git clone https://github.com/giovancarl444/megaphone.git
)
cd /d D:\megaphone
call npm install
call npm run identity
echo.
echo ============================================
echo  MEGAPHONE setup complete.
echo  - A fresh pump.fun wallet was created + JWT minted.
echo  - Starting the live daemon (firehose + proof loop)...
echo  - To POST calls, your residential IP must reach pump.fun (it does here).
echo  - Press Ctrl+C to stop. To run forever: use the Task Scheduler bat.
echo ============================================
call npm run daemon
