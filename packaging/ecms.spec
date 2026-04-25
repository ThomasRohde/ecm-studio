# Build with: pyinstaller packaging/ecms.spec
from pathlib import Path

block_cipher = None
root = Path.cwd()


a = Analysis(
    [str(root / "src" / "ecm_studio" / "cli.py")],
    pathex=[str(root / "src")],
    binaries=[],
    datas=[
        (str(root / "ui" / "dist"), "ecm_studio/assets/ui"),
        (str(root / "packaging" / "assets" / "ecm-studio.ico"), "ecm_studio/assets"),
    ],
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
    name="ecms",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(root / "packaging" / "assets" / "ecm-studio.ico"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="ecms",
)
