# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
"""Assemble src/ into a single self-contained index.html."""
from pathlib import Path
root = Path(__file__).parent
html = (root / "src/template.html").read_text()
for tag, name in [("/*__CORE__*/", "core.js"), ("/*__BUILD__*/", "build.js"), ("/*__STEP2__*/", "step2.js"), ("/*__STEP3__*/", "step3.js")]:
    html = html.replace(tag, (root / "src" / name).read_text())
(root / "index.html").write_text(html)
print("Wrote index.html")
