@echo off
REM 独立于会话运行：VS Build Tools（仅 C++ 编译/链接 + Windows SDK）
set INSTALLER=%LOCALAPPDATA%\Temp\WinGet\Microsoft.VisualStudio.2022.BuildTools.17.14.42\vs_BuildTools.exe
if not exist "%INSTALLER%" (
  echo installer not found: %INSTALLER%
  exit /b 1
)
"%INSTALLER%" ^
  --quiet --wait --norestart ^
  --installPath "C:\BuildTools" ^
  --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
  --add Microsoft.VisualStudio.Component.Windows11SDK.26100 ^
  --add Microsoft.VisualStudio.Component.VC.CMake.Project ^
  > "%TEMP%\vsbuildtools-install.log" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%TEMP%\vsbuildtools-install.log"
