#!/usr/bin/env python3
"""兼容入口：请改用 taojin/ 目录下脚本。"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parent / "taojin" / "step2_get_token.py"), run_name="__main__")
