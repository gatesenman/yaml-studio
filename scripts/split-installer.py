#!/usr/bin/env python3
"""Create 20 MiB Windows installer volumes and an ASCII CMD merge/verify script."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SIZE = 20 * 1024 * 1024


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def split_installer(installer, output):
    if not installer.is_file() or not re.fullmatch(r'[A-Za-z0-9._ -]+', installer.name):
        raise ValueError('Installer must exist and have a safe ASCII filename')
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Output directory must be empty; existing files are never overwritten')
    expected = digest(installer)
    parts = []
    with installer.open('rb') as stream:
        index = 1
        while block := stream.read(SIZE):
            target = output / (installer.name + '.part' + str(index).zfill(2))
            with target.open('xb') as part:
                part.write(block)
            parts.append({'name': target.name, 'bytes': len(block), 'sha256': digest(target)})
            index += 1
    if not parts:
        raise ValueError('Empty installer')
    lines = ['@echo off', 'setlocal DisableDelayedExpansion', 'cd /d "%~dp0"',
             'set "EXPECTED_SHA=' + expected + '"',
             'set "OUTPUT_FILE=%~dp0' + installer.name + '"',
             'set "TEMP_OUTPUT=%~dp0' + installer.name + '.reassembling"',
             'set "MISSING="']
    for part in parts:
        name = part['name']
        lines += ['if not exist "' + name + '" (',
                  ' echo Missing volume: ' + name, ' set "MISSING=1"', ')']
    lines += ['if defined MISSING goto fail', 'set "BAD_SIZE="']
    for part in parts:
        lines += ['for %%F in ("' + part['name'] + '") do if not "%%~zF"=="' + str(part['bytes']) + '" (',
                  ' echo Incorrect volume size: ' + part['name'], ' set "BAD_SIZE=1"', ')']
    lines += ['if defined BAD_SIZE goto fail', 'where powershell >nul 2>&1',
              'if errorlevel 1 (echo Windows PowerShell is required.& goto fail)',
              'if exist "%OUTPUT_FILE%" (echo Output already exists. Rename it first; nothing was overwritten.& goto fail)',
              'if exist "%TEMP_OUTPUT%" (echo Temporary output already exists. Rename or remove it first.& goto fail)',
              'echo Combining ' + str(len(parts)) + ' volumes...',
              'copy /b ' + '+'.join('"' + p['name'] + '"' for p in parts) + ' "%TEMP_OUTPUT%" >nul',
              'if errorlevel 1 goto hash_failed', 'echo Checking SHA256...',
              'powershell -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference=\'Stop\'; $actual=(Get-FileHash -LiteralPath $env:TEMP_OUTPUT -Algorithm SHA256).Hash; if($actual -ne $env:EXPECTED_SHA){Write-Host \'SHA256 mismatch. Download all volumes again.\'; exit 1}; [IO.File]::Move($env:TEMP_OUTPUT,$env:OUTPUT_FILE)"',
              'if errorlevel 1 goto hash_failed',
              'echo SHA256 verified: %EXPECTED_SHA%', 'echo Created: "%OUTPUT_FILE%"',
              'echo No installer was started. Run the EXE manually when ready.', 'pause', 'exit /b 0',
              ':hash_failed', 'if exist "%TEMP_OUTPUT%" del /q "%TEMP_OUTPUT%"',
              ':fail', 'echo Merge failed. No installer was started.', 'pause', 'exit /b 1']
    (output / '合并安装包.cmd').write_bytes(('\r\n'.join(lines) + '\r\n').encode('ascii'))
    manifest = {'installer': installer.name, 'bytes': installer.stat().st_size,
                'sha256': expected, 'partSize': SIZE, 'parts': parts}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    (output / 'SHA256SUMS-parts.txt').write_text(''.join(p['sha256'] + '  ' + p['name'] + '\n' for p in parts), encoding='ascii')
    (output / '分卷说明.txt').write_text(
        'YAML Studio Windows x64 安装包分卷\n\n'
        + '安装包：' + installer.name + '。共' + str(len(parts)) + '片，每片最多20 MiB，均小于25 MB附件上限。\n'
        + '请将全部 .part 文件与“合并安装包.cmd”放在同一个文件夹。不要直接打开part文件。\n'
        + 'Windows 10/11 双击“合并安装包.cmd”，脚本先检查所有分片和长度，再用 copy /b 合并，并用系统PowerShell校验SHA256。\n'
        + '成功后生成原文件名：' + installer.name + '。脚本不会自动执行安装程序，需自行决定是否运行。\n'
        + '目标文件或临时文件已存在时不会覆盖，请先自行改名确认；缺片/大小不符时不会合并，校验失败时删除本次临时输出。\n'
        + '建议预留至少300 MB磁盘空间。文件来自未签名的Linux交叉构建，Windows实机安装/卸载与CMD执行尚未验证；不得视为已完成Windows验收。\n'
        + '原安装包SHA256：' + expected + '\n'
        + '每片SHA256见SHA256SUMS-parts.txt；完整大小和顺序见manifest.json。请勿改名或混用不同版本分片。\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('installer', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    print(json.dumps(split_installer(args.installer, args.output), indent=2))
