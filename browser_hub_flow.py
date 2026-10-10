# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio, zipfile, io, re
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1300,"height":820}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:400]))
        await pg.goto("file://" + __import__("os").path.abspath("index.html") + ""); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", "tests/out/world.zip"); await pg.wait_for_timeout(2000)
        for i in range(3): await pg.evaluate(f"__wm.keepPlace({i})")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(400)
        await pg.check("#m-hub"); await pg.wait_for_timeout(200)
        print("build disabled before placing:", await pg.is_disabled("#m-build"))
        await pg.mouse.click(120, 700); await pg.wait_for_timeout(300)
        sect = await pg.inner_text("#pane-museum")
        print(re.search(r"Transporter hub\n(.*?)\nDirectory", sect, re.S).group(1))
        print("build disabled after placing:", await pg.is_disabled("#m-build"))
        await pg.screenshot(path="tests/out/hubui.png")
        await pg.click("#m-build")
        async with pg.expect_download(timeout=60000) as dl:
            await pg.wait_for_selector("#m-save", timeout=60000); await pg.click("#m-save")
        print((await pg.inner_text("#m-result")).split("\n")[1])
        z = zipfile.ZipFile(io.BytesIO(open(await (await dl.value).path(),"rb").read())); z.extractall("tests/out/hubui_w")
        print(z.read("museum-directory.txt").decode()[:400])
        print(errs); await b.close()
asyncio.run(main())
