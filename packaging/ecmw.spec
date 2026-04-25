# Build with: pyinstaller packaging/ecmw.spec
from pathlib import Path

block_cipher = None
root = Path.cwd()


a = Analysis(
    [str(root / "src" / "ecm_workbench" / "cli.py")],
    pathex=[str(root / "src")],
    binaries=[],
    datas=[(str(root / "ui" / "dist"), "ecm_workbench/assets/ui")],
    hiddenimports=["webview.platforms.edgechromium"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ecmw",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ecmw",
)
