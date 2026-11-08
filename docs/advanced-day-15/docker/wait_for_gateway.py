"""Ждём /health шлюза (loopback внутри контейнера с общим network namespace)."""

import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:5013/health"


def main() -> int:
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(URL, timeout=2) as resp:  # noqa: S310
                if resp.status == 200:
                    return 0
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(1)
    print("gateway не поднялся за 60 секунд", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
