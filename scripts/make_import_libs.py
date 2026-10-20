#!/usr/bin/env python3
"""在没有 Visual Studio Build Tools 的 Windows 上，用系统自带 DLL 生成 MSVC import lib。

背景：Rust 的 x86_64-pc-windows-msvc 目标需要 kernel32.lib / ntdll.lib 等
import library（微软只在 VS Build Tools / Windows SDK 里提供）。本脚本直接解析
C:\\Windows\\System32 下 DLL 的导出表，生成 .def，再调用 lld-link 生成 .lib。

用法：
    python scripts/make_import_libs.py <输出目录> [DLL 名称...]

依赖：lld-link.exe（Rust 自带 rust-lld 改名即可）：
    cp ~/.rustup/toolchains/*/lib/rustlib/x86_64-pc-windows-msvc/bin/rust-lld.exe lld-link.exe
"""
from __future__ import annotations

import os
import struct
import subprocess
import sys

SYSTEM32 = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")

# 常用 Win32 DLL（Rust std + windows-sys + Tauri 链路会链接到）
DEFAULT_DLLS = [
    "kernel32", "kernelbase", "ntdll", "userenv", "ws2_32", "dbghelp",
    "advapi32", "bcrypt", "user32", "gdi32", "shell32", "ole32", "oleaut32",
    "comdlg32", "comctl32", "shlwapi", "psapi", "setupapi", "version", "imm32",
    "winmm", "uxtheme", "dwmapi", "crypt32", "wintrust", "iphlpapi", "netapi32",
    "dnsapi", "mpr", "oleacc", "hid", "cfgmgr32", "powrprof", "secur32",
    "netbios", "userenv", "wtsapi32", "wlanapi", "avrt", "dxgi", "d3d11",
    "d3d9", "dwrite", "d2d1", "windowscodecs", "uiautomationcore", "shcore",
    "propsys", "taskschd", "mswsock", "ws2help", "imagehlp", "dbgcore",
]


def _rva_to_offset(rva: int, sections: list[tuple[int, int, int, int]]) -> int:
    for va, vsize, raw_off, raw_size in sections:
        if va <= rva < va + max(vsize, raw_size):
            return raw_off + (rva - va)
    raise ValueError(f"无法把 RVA 0x{rva:x} 映射到文件偏移")


def read_exports(dll_path: str) -> list[str]:
    """返回 DLL 导出的符号名列表。"""
    with open(dll_path, "rb") as f:
        data = f.read()

    if data[:2] != b"MZ":
        raise ValueError("不是 PE 文件")
    pe_off = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_off:pe_off + 4] != b"PE\0\0":
        raise ValueError("PE 签名无效")

    coff = pe_off + 4
    num_sections = struct.unpack_from("<H", data, coff + 2)[0]
    opt_size = struct.unpack_from("<H", data, coff + 16)[0]
    opt = coff + 20
    magic = struct.unpack_from("<H", data, opt)[0]
    if magic == 0x20B:  # PE32+
        dd_off = opt + 112
    elif magic == 0x10B:  # PE32
        dd_off = opt + 96
    else:
        raise ValueError(f"未知 OptionalHeader magic 0x{magic:x}")

    export_rva, export_size = struct.unpack_from("<II", data, dd_off)
    if not export_rva:
        return []

    sec_off = opt + opt_size
    sections: list[tuple[int, int, int, int]] = []
    for i in range(num_sections):
        base = sec_off + i * 40
        vsize, va, raw_size, raw_off = struct.unpack_from("<IIII", data, base + 8)
        sections.append((va, vsize, raw_off, raw_size))

    exp_off = _rva_to_offset(export_rva, sections)
    (_chars, _ts, _maj, _min, _name_rva, _base, num_funcs, num_names,
     _addr_funcs, addr_names, addr_ords) = struct.unpack_from(
        "<IIHHIIIIIII", data, exp_off)

    names: list[str] = []
    for i in range(num_names):
        name_rva = struct.unpack_from("<I", data, _rva_to_offset(addr_names, sections) + i * 4)[0]
        off = _rva_to_offset(name_rva, sections)
        end = data.index(b"\0", off)
        names.append(data[off:end].decode("ascii", "ignore"))
    return names


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    out_dir = os.path.abspath(sys.argv[1])
    dlls = sys.argv[2:] or DEFAULT_DLLS
    os.makedirs(out_dir, exist_ok=True)

    lld = os.environ.get("LLD_LINK")
    if not lld:
        print("请通过环境变量 LLD_LINK 指定 lld-link.exe 路径", file=sys.stderr)
        return 2

    ok = failed = 0
    for entry in dlls:
        # 支持 "ucrt=ucrtbase"：库名 ucrt.lib，实际导入 ucrtbase.dll
        if "=" in entry:
            lib_name, dll_name = entry.split("=", 1)
        else:
            lib_name = dll_name = entry
        dll_path = os.path.join(SYSTEM32, f"{dll_name}.dll")
        if not os.path.exists(dll_path):
            print(f"跳过 {dll_name}.dll（系统里没有）")
            continue
        try:
            exports = read_exports(dll_path)
        except Exception as exc:  # noqa: BLE001
            print(f"解析 {dll_name}.dll 失败：{exc}")
            failed += 1
            continue
        if not exports:
            print(f"跳过 {dll_name}.dll（无导出）")
            continue

        def_path = os.path.join(out_dir, f"{lib_name}.def")
        with open(def_path, "w", encoding="ascii", errors="ignore") as f:
            f.write(f"LIBRARY {dll_name}.dll\nEXPORTS\n")
            for sym in sorted(set(exports)):
                if sym and all(32 <= ord(c) < 127 for c in sym):
                    f.write(f"{sym}\n")

        lib_path = os.path.join(out_dir, f"{lib_name}.lib")
        dll_out = os.path.join(out_dir, f"{lib_name}.stub.dll")
        proc = subprocess.run(
            [lld, "/nologo", f"/def:{def_path}", f"/out:{dll_out}",
             f"/implib:{lib_path}", "/noentry", "/dll", "/machine:x64"],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print(f"生成 {lib_name}.lib 失败：{proc.stdout.strip()} {proc.stderr.strip()}")
            failed += 1
            continue
        os.remove(def_path)
        if os.path.exists(dll_out):
            os.remove(dll_out)
        ok += 1
        print(f"OK {lib_name}.lib（{len(set(exports))} 个导出）")

    print(f"\n完成：成功 {ok}，失败 {failed}，输出目录 {out_dir}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
