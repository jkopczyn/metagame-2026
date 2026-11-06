#!/usr/bin/env python3
"""Inline fonts/logos from assets/ into template.html -> metagame-signs.html (single self-contained file)."""
import base64, mimetypes, pathlib, re

root = pathlib.Path(__file__).parent
tpl = (root / "template.html").read_text()

def inline(m):
    p = root / "assets" / m.group(1)
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    if p.suffix == ".woff2":
        mime = "font/woff2"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"

out = re.sub(r"__ASSET:(.+?)__", inline, tpl)
(root / "metagame-signs.html").write_text(out)
print(f"wrote metagame-signs.html ({len(out)//1024} KB)")
