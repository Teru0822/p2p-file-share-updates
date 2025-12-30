@echo off
cd /d %~dp0
echo ==========================================
echo   ProxiPass Firewall Setup Utility
echo ==========================================
echo.
echo Requesting administrator privileges to update firewall rules...

:: Check for Administrator privileges
openfiles >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo Please confirm the UAC prompt to proceed...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo [1/3] Removing old rules (if any)...
netsh advfirewall firewall delete rule name="ProxiPass Discovery (UDP)" >nul 2>&1
netsh advfirewall firewall delete rule name="ProxiPass Transfer (TCP)" >nul 2>&1
netsh advfirewall firewall delete rule name="P2P File Share" >nul 2>&1

echo [2/3] Adding new inbound rules...
:: Allow UDP Port 45678 for Discovery
netsh advfirewall firewall add rule name="ProxiPass Discovery (UDP)" dir=in action=allow protocol=UDP localport=45678 profile=any description="Allow ProxiPass device discovery."

:: Allow TCP Port 45679 for File Transfer
netsh advfirewall firewall add rule name="ProxiPass Transfer (TCP)" dir=in action=allow protocol=TCP localport=45679 profile=any description="Allow ProxiPass file transfer."

echo [3/3] Verifying...
netsh advfirewall firewall show rule name="ProxiPass Discovery (UDP)" | findstr "Rule Name"
netsh advfirewall firewall show rule name="ProxiPass Transfer (TCP)" | findstr "Rule Name"

echo.
echo ==========================================
echo   Success! Firewall rules updated.
echo   You can now connect with other devices.
echo ==========================================
echo.
pause
