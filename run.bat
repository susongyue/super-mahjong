@echo off
chcp 65001 >nul
cd /d E:\Desktop\Super\super-mahjong

:menu
cls
echo ============================
echo   超能力立直麻将 - 服务器管理
echo ============================
echo [1] 启动服务器
echo [2] 关闭服务器
echo [0] 退出
echo ============================
set /p choice=请选择操作 (0-2):

if "%choice%"=="1" goto start_server
if "%choice%"=="2" goto stop_server
if "%choice%"=="0" goto end
goto menu

:start_server
echo 正在启动服务器...
node server.js
goto menu

:stop_server
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
    echo 已关闭进程 %%a
    set killed=1
)
if not defined killed echo 没有找到正在运行的服务器 (端口3000)
set killed=
pause
goto menu

:end
exit
