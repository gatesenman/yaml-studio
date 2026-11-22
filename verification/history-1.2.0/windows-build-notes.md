# Linux Windows构建环境记录

2026-11-22 Asia/Shanghai。Debian Wine 10.0~repack-6在TMPDIR设置且/run/user/$uid不可写/不存在时可能free(): invalid pointer。公开缺陷#1110936：https://www.mail-archive.com/debian-wine@lists.debian.org/msg01912.html 。本任务取消子进程TMPDIR/TEMP/TMP后，原标准NSIS构建成功；不是代码签名或安装器逻辑失败。构建使用独立Xvfb/WINEPREFIX，随后仅清理本任务临时配置。

内存盘仅用于临时数据；不把它当作最终持久化交付位置。最终EXE和全部分片均在/workspace/yaml-studio-delivery/v1.2.0。
