@echo off
chcp 65001 >nul
rem Запуск «Сонного помощника». Положите ярлык на этот файл в папку автозагрузки (Win+R → shell:startup).
cd /d "%~dp0\.."
:loop
call npm start
echo Бот остановился, перезапуск через 10 секунд...
timeout /t 10 /nobreak >nul
goto loop
