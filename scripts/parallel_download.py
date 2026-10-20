#!/usr/bin/env python3
"""分片并行下载器：微软 CDN 单连接很慢，多连接并发可以显著提速。

用法：python scripts/parallel_download.py <url> <输出文件> [并发数]
"""
from __future__ import annotations

import os
import sys
import threading
import urllib.request

CHUNK = 4 * 1024 * 1024


def fetch_range(url: str, start: int, end: int, path: str, idx: int) -> None:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(path, "r+b") as f:
        f.seek(start)
        while True:
            block = resp.read(256 * 1024)
            if not block:
                break
            f.write(block)


def main() -> int:
    url, out = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 8

    total = 0
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", "0"))
    except Exception:  # noqa: BLE001
        total = 0
    if not total:
        # 某些 CDN 对 HEAD 不返回长度，用 Range 探测总量
        req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            cr = resp.headers.get("Content-Range", "")
            if "/" in cr:
                total = int(cr.rsplit("/", 1)[1])
    print(f"size = {total / 1048576:.1f} MB, workers = {workers}", flush=True)
    if not total:
        print("拿不到 Content-Length")
        return 1

    with open(out, "wb") as f:
        f.truncate(total)

    ranges = []
    pos = 0
    while pos < total:
        end = min(pos + CHUNK, total) - 1
        ranges.append((pos, end))
        pos = end + 1

    lock = threading.Lock()
    done = [0]
    errors: list[str] = []

    def worker(items):
        for start, end in items:
            for attempt in range(4):
                try:
                    fetch_range(url, start, end, out, 0)
                    break
                except Exception as exc:  # noqa: BLE001
                    if attempt == 3:
                        with lock:
                            errors.append(f"{start}-{end}: {exc}")
                    else:
                        import time

                        time.sleep(1.5 * (attempt + 1))

    threads = []
    for i in range(workers):
        chunk = ranges[i::workers]
        t = threading.Thread(target=worker, args=(chunk,), daemon=True)
        t.start()
        threads.append(t)

    import time

    last = 0
    while any(t.is_alive() for t in threads):
        time.sleep(3)
        size = os.path.getsize(out)
        # 以已分配区间中完成的比例估算：用 mtime 变化不直观，这里直接看总大小不可靠，
        # 改为统计线程完成度
        with lock:
            pass
    for t in threads:
        t.join()

    if errors:
        print("下载出错：")
        for e in errors:
            print("  ", e)
        return 1
    print(f"完成：{out}（{os.path.getsize(out) / 1048576:.1f} MB）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
