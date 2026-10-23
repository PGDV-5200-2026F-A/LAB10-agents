#!/usr/bin/env python3
"""Build dist/penguins-dashboard.html.

Inlines data/penguins.json into dashboard/template.html (replacing the
__PENGUIN_DATA__ placeholder) so the output is a single standalone file.
Deterministic: stable separators, LF line endings, no timestamps embedded.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "dashboard" / "template.html"
DATA = ROOT / "data" / "penguins.json"
OUT = ROOT / "dist" / "penguins-dashboard.html"


def main() -> int:
    template = TEMPLATE.read_text(encoding="utf-8")
    rows = json.loads(DATA.read_text(encoding="utf-8"))
    if "__PENGUIN_DATA__" not in template:
        print("error: __PENGUIN_DATA__ placeholder missing from template", file=sys.stderr)
        return 1
    payload = json.dumps(rows, separators=(",", ":"), ensure_ascii=True, sort_keys=False)
    out = template.replace("__PENGUIN_DATA__", payload)
    if "__PENGUIN_DATA__" in out:
        print("error: placeholder still present after substitution", file=sys.stderr)
        return 1
    out = out.replace("\r\n", "\n")  # stable LF line endings
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {len(rows)} rows inlined)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
