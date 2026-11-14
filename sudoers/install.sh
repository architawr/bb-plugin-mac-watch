#!/bin/sh
# Installs /etc/sudoers.d/bb-mac-watch: lets Mac Watch run exactly these root
# commands without a password. Nothing else changes. Run it yourself, not with sudo:
#   sh sudoers/install.sh
# Remove with: sudo rm /etc/sudoers.d/bb-mac-watch
set -eu
user=$(id -un)
if [ "$user" = root ]; then echo "Запустите без sudo: скрипт сам спросит пароль." >&2; exit 1; fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cat > "$tmp" <<RULE
# Mac Watch (BB plugin): sleep, timed wake and shutdown without a password.
Cmnd_Alias BB_MACWATCH = /usr/bin/pmset disablesleep 0, \\
                         /usr/bin/pmset disablesleep 1, \\
                         /usr/bin/pmset relative wake 3600, \\
                         /usr/bin/pmset relative wake 14400, \\
                         /usr/bin/pmset relative wake 28800, \\
                         /sbin/shutdown -h now
$user ALL=(root) NOPASSWD: BB_MACWATCH
RULE
/usr/sbin/visudo -c -f "$tmp" >/dev/null
# The file name must not contain a dot, or sudo silently skips it.
sudo /usr/bin/install -m 0440 -o root -g wheel "$tmp" /etc/sudoers.d/bb-mac-watch
sudo /usr/sbin/visudo -c >/dev/null
echo "Готово: /etc/sudoers.d/bb-mac-watch установлен."
