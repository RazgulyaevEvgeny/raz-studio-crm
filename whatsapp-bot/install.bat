@echo off
rem Установка WhatsApp-бота на рабочий компьютер: двойной щелчок по этому файлу.
rem Можно запускать повторно: обновит компоненты и перезапустит бота.
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Установка WhatsApp-бота RAZ ===
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Не найдена программа Node.js, она нужна для работы бота. Устанавливаю...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Если установка прошла, закройте это окно и запустите install.bat ещё раз.
  pause
  exit /b
)

echo [1/4] Скачиваю компоненты бота...
call npm install --omit=dev --no-fund --no-audit
if errorlevel 1 (
  echo Не получилось скачать компоненты. Проверьте интернет и запустите install.bat ещё раз.
  pause
  exit /b
)

echo [2/4] Настройки...
if not exist .env (
  copy .env.example .env >nul
  echo Сейчас откроется Блокнот. Заполните BOT_EMAIL, BOT_PASSWORD и GEMINI_API_KEY, сохраните и закройте Блокнот.
  start /wait notepad .env
)

echo [3/4] Включаю автозапуск при входе в Windows...
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\RAZ WhatsApp bot.vbs"
> "%VBS%" echo CreateObject("WScript.Shell").Run """%~dp0start.bat""", 0, False

echo [4/4] Запускаю бота в фоне...
call "%~dp0stop.bat" >nul
wscript "%VBS%"
timeout /t 8 /nobreak >nul
start "" http://localhost:3777

echo.
echo Готово. В браузере открылась страница бота. Если там QR-код, отсканируйте его телефоном:
echo WhatsApp - Настройки - Связанные устройства - Привязка устройства.
echo Это окно можно закрыть.
pause
