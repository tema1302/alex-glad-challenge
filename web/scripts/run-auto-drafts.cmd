@echo off
rem BlogAutoDrafts runner (see register-schedule.ps1).
rem Writes 2 drafts into the /blog/posts queue; last run log:
rem   challenge\.data\auto-drafts-last.log
cd /d E:\IT\alex-glad-challenge\web
set NODE_OPTIONS=--conditions=react-server
"E:\IT\alex-glad-challenge\challenge\node_modules\.bin\tsx.CMD" scripts\auto-drafts.ts --posts 2 > "E:\IT\alex-glad-challenge\challenge\.data\auto-drafts-last.log" 2>&1
