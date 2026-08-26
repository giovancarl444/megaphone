@echo off
cd /d D:\megaphone
D:\megaphone\node_modules\.bin\tsx src/daemon.ts >> D:\megaphone\.daemon.out.log 2>&1
