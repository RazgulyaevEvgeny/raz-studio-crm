@echo off
chcp 65001 >nul
echo Останавливаю WhatsApp-бота...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*%~dp0start.bat*' -or $_.CommandLine -like '*--env-file=.env bot.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Готово. Бот снова запустится при следующем входе в Windows или после install.bat.
timeout /t 3 >nul
