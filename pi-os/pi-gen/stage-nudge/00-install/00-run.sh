#!/bin/bash -e
# Copies the nudge-pi bundle into the image and runs its installer in image mode.
install -d "${ROOTFS_DIR}/opt/nudge-install"
tar -xzf "${STAGE_DIR}/files/nudge-pi.tar.gz" -C "${ROOTFS_DIR}/opt/nudge-install" --strip-components=1
on_chroot <<CHROOT
bash /opt/nudge-install/install.sh --image
rm -rf /opt/nudge-install
apt-get clean
CHROOT
