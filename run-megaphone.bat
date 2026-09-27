@echo off
cd /d D:\megaphone
start "" /min cmd /c "node node_modules/tsx/dist/cli.mjs src/supervisor.ts > .daemon.out.log 2>&1"
exit
