#!/bin/sh
set -eu
mkdir -p /run/xrdp /root/.vnc
openssl req -x509 -newkey rsa:2048 -nodes -keyout /etc/xrdp/key.pem -out /etc/xrdp/cert.pem -days 1 -subj /CN=desktop >/dev/null 2>&1
printf '%s\n' 'b10-pass' | vncpasswd -f > /root/.vnc/passwd
chmod 600 /root/.vnc/passwd
Xvnc :0 -geometry 800x600 -depth 24 -rfbport 5900 -localhost no -AlwaysShared -SecurityTypes VncAuth -PasswordFile /root/.vnc/passwd > /tmp/vnc.log 2>&1 &
export DISPLAY=:0
until xdotool getmouselocation >/dev/null 2>&1; do sleep 0.1; done
xterm -geometry 80x24+0+0 -title B10-Desktop -e sh -c 'printf "B10 real desktop ready\n"; cat > /tmp/typed.txt' > /tmp/xterm.log 2>&1 &
exec xrdp --nodaemon --config /etc/xrdp/xrdp.ini
