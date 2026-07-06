@echo off
cd /d "%~dp0"
set MS_HOST=127.0.0.1
set MS_PORT=8090

echo.
echo ===============================================
echo  MULTISERVICIOS - SERVIDOR LOCAL
echo ===============================================
echo.
echo Sitio completo:
echo   http://127.0.0.1:%MS_PORT%/sitio-completo/
echo.
echo Admin:
echo   http://127.0.0.1:%MS_PORT%/admin/
echo.
echo Clave admin:
echo   MULTISERVICIOS
echo.
echo Si el puerto %MS_PORT% esta ocupado, cierra el servidor anterior.
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py server.py
  goto end
)

echo No encontre Python instalado en este equipo.
echo Instala Python 3 o abre el proyecto desde Codex para ejecutarlo.

:end
echo.
echo Servidor detenido.
pause
