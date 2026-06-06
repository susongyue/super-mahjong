@echo off
chcp 65001 >nul
cd E:\Desktop\Super\super-mahjong

:menu
cls
echo ============================
echo [1] 下载
echo [2] 清楚缓存
echo [0] 退出
echo ============================
set /p choice=请选择操作 (0-2):

if "%choice%"=="1" goto install
if "%choice%"=="2" goto cache_clean
if "%choice%"=="0" goto end
goto menu

:install
call npm install
pause
goto menu

:cache_clean
call npm cache clean --force
pause
goto menu

:end
exit