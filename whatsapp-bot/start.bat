@echo off
rem Запускает бота и перезапускает его, если он упал. Обычно запускается сам при входе в Windows (в фоне).
chcp 65001 >nul
cd /d "%~dp0"
:loop
for %%F in (bot.log) do if %%~zF GTR 5000000 move /y bot.log bot.old.log >nul
node --env-file=.env bot.js >> bot.log 2>&1
rem Код 3: бот уже работает, второй не нужен
if %errorlevel%==3 exit /b
timeout /t 10 /nobreak >nul
goto loop
