@echo off
chcp 65001 >nul
cd /d E:\Desktop\Super\super-mahjong

:menu
cls
echo ============================
echo   推送项目到 GitHub
echo ============================
echo [1] 快速推送到已配置的远程仓库
echo [2] 初始化 Git 仓库并配置远程地址
echo [3] 自定义提交信息并推送
echo [0] 退出
echo ============================
set /p choice=请选择操作 (0-3):

if "%choice%"=="1" goto quick_push
if "%choice%"=="2" goto init_repo
if "%choice%"=="3" goto custom_push
if "%choice%"=="0" goto end
goto menu

:: ── 快速推送 ──
:quick_push
echo.
echo 正在检查 Git 仓库状态...

:: 检查是否已初始化
git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (
    echo [错误] 尚未初始化 Git 仓库，请先选择 [2] 初始化
    pause
    goto menu
)

:: 检查远程仓库
git remote -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未配置远程仓库，请先选择 [2] 配置
    pause
    goto menu
)

:: 生成时间戳提交信息
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do set d=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a:%%b
set msg=更新 %d% %t%

echo 提交信息: %msg%
echo.
echo 步骤 1/3: 添加所有更改...
git add .
if errorlevel 1 (echo [错误] 添加失败 & pause & goto menu)

echo 步骤 2/3: 提交更改...
git commit -m "%msg%"
if errorlevel 1 (
    echo 没有需要提交的更改或提交失败
)

echo 步骤 3/3: 推送到远程仓库...
git push
if errorlevel 1 (
    echo [错误] 推送失败，请检查网络连接和仓库权限
) else (
    echo [成功] 已推送到 GitHub!
)
pause
goto menu

:: ── 初始化并配置远程 ──
:init_repo
echo.
echo ============================
echo   初始化 Git 仓库
echo ============================
echo.

:: 检查是否已初始化
git rev-parse --git-dir >nul 2>&1
if not errorlevel 1 (
    echo Git 仓库已初始化，跳过初始化步骤
    echo.
    echo 当前远程地址:
    git remote -v
    echo.
    set /p change=是否需要修改远程地址？(y/n):
    if /i "%change%"=="y" goto set_remote
    pause
    goto menu
)

echo 请确认你的 GitHub 仓库地址
echo 格式示例: https://github.com/用户名/仓库名.git
echo.
set /p repo_url=请输入远程仓库地址:

if "%repo_url%"=="" (
    echo [取消] 未输入地址，返回菜单
    pause
    goto menu
)

echo.
echo 正在初始化 Git 仓库...
git init
if errorlevel 1 (echo [错误] 初始化失败 & pause & goto menu)
echo [成功] Git 仓库已初始化

:set_remote
if "%repo_url%"=="" (
    set /p repo_url=请输入远程仓库地址:
)
if "%repo_url%"=="" (
    echo [取消] 未输入地址
    pause
    goto menu
)

:: 先移除已存在的 origin
git remote remove origin >nul 2>&1
git remote add origin "%repo_url%"
if errorlevel 1 (
    echo [错误] 添加远程仓库失败
    pause
    goto menu
)
echo [成功] 远程仓库已配置: %repo_url%

:: 创建 .gitignore
echo.
set /p create_gitignore=是否创建 .gitignore 排除 node_modules？(y/n):
if /i "%create_gitignore%"=="y" (
    if exist .gitignore (
        echo .gitignore 已存在，跳过
    ) else (
        echo node_modules/ > .gitignore
        echo .env >> .gitignore
        echo *.log >> .gitignore
        echo 已创建 .gitignore
    )
)

:: 首次提交并推送
echo.
echo 执行首次提交和推送...
git add .
git commit -m "初次提交 - 超能力立直麻将"
git branch -M main
git push -u origin main
if errorlevel 1 (
    echo.
    echo [提示] 首次推送可能失败，请确认:
    echo   1. GitHub 仓库已创建
    echo   2. 仓库地址正确
    echo   3. 若需认证，请在浏览器登录 GitHub
    echo.
) else (
    echo [成功] 项目已推送到 GitHub!
)
pause
goto menu

:: ── 自定义提交 ──
:custom_push
echo.
echo ============================
echo   自定义提交并推送
echo ============================
echo.

git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (
    echo [错误] 尚未初始化 Git 仓库
    pause
    goto menu
)

:: 显示当前状态
echo 当前文件变更:
git status --short
echo.
set /p commit_msg=请输入提交信息:

if "%commit_msg%"=="" (
    echo [取消] 未输入提交信息
    pause
    goto menu
)

echo.
echo 正在添加文件...
git add .
echo 正在提交...
git commit -m "%commit_msg%"
if errorlevel 1 (
    echo [提示] 没有内容变更或提交失败
) else (
    echo [成功] 提交完成
)

echo 正在推送...
git push
if errorlevel 1 (
    echo [错误] 推送失败
) else (
    echo [成功] 已推送到远程仓库!
)
pause
goto menu

:end
exit
