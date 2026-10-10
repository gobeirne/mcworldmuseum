# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio, re
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1300,"height":820}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:300]))
        await pg.goto("file://" + __import__("os").path.abspath("index.html") + ""); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", ["tests/out/trouble.zip", "tests/out/speckle.zip"]); await pg.wait_for_timeout(3500)
        for i in range(3): await pg.evaluate(f"__wm.keepPlace({i})")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(400)
        await pg.check("#m-hub"); await pg.mouse.click(120, 700); await pg.wait_for_timeout(300)
        t = await pg.inner_text("#pane-museum"); i = t.find("Museum ready to build"); print(t[i:i+560]); print("---")
        await pg.click("#m-build")
        async with pg.expect_download(timeout=90000) as dl:
            await pg.wait_for_selector("#m-save", timeout=90000); await pg.click("#m-save")
        print((await pg.inner_text("#m-result"))[:400]); print("---")
        await pg.click("details.report summary"); await pg.wait_for_timeout(100)
        await pg.screenshot(path="tests/out/reportui.png")
        async with pg.expect_download() as d2: await pg.click("#m-savereport")
        print("report file:", (await d2.value).suggested_filename, errs)
        await b.close()
asyncio.run(main())
