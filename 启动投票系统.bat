@echo off
chcp 65001 >nul
title 校园十佳歌手 实时投票系统
cd /d "%~dp0"

echo 正在启动投票系统...
rem 2 秒后自动用默认浏览器打开管理后台
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3000/admin"

node server.js

echo.
echo 服务已停止。
pause
