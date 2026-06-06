@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ==========================================
echo   角色数据同步工具
echo   按 B 列 ID (SRM####) 匹配
echo ==========================================
echo.
echo   [1] xlsx → JSON  (读取Excel覆盖JSON)
echo   [2] JSON → xlsx  (读取JSON更新Excel)
echo   [0] 退出
echo.
set /p choice="请选择 (0-2): "

if "%choice%"=="1" goto xlsx2json
if "%choice%"=="2" goto json2xlsx
if "%choice%"=="0" goto end

echo 无效选择，请按任意键退出...
pause >nul
goto end

:xlsx2json
echo.
echo [xlsx → JSON] 进行中...
python tools\sync_characters.py --to-json
echo.
echo 完成！按任意键退出...
pause >nul
goto end

:json2xlsx
echo.
echo [JSON → xlsx] 进行中...
python tools\sync_characters.py --to-xlsx
echo.
echo 完成！按任意键退出...
pause >nul
goto end

:end
