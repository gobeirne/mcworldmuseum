# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2, has_touch=True, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + __import__("os").path.abspath("index.html") + ""); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", "tests/out/world.zip"); await pg.wait_for_timeout(2000)
        print("tabs:", await pg.locator("#mnav button:visible").all_inner_texts())
        x, y = await pg.evaluate("__wm.pin(0)"); print("pin at", round(x), round(y), await pg.evaluate("document.elementFromPoint(%d,%d).id" % (x, y - 20)))
        await pg.mouse.click(x, y - 20); await pg.wait_for_timeout(300)
        await pg.screenshot(path="tests/out/mob-card.png")
        await pg.click("#pop [data-keep]"); await pg.wait_for_timeout(300)
        print("card after keep:", (await pg.inner_text("#pop")).split("\n")[-1])
        await pg.screenshot(path="tests/out/mob-card2.png")
        await pg.click('#mnav button[data-tab=exhibits]'); await pg.wait_for_timeout(200)
        print("kept cards:", await pg.locator(".ex").count())
        await pg.click('.ex >> nth=0 >> [data-act=show]'); await pg.wait_for_timeout(500)
        print("after show, tab:", await pg.evaluate("document.querySelector('#mnav [aria-selected=true]').dataset.tab"))
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(500)
        await pg.click('#mnav button[data-tab=museum]'); await pg.wait_for_timeout(200)
        await pg.click("#m-build")
        async with pg.expect_download(timeout=60000) as dl:
            await pg.wait_for_selector("#m-save", timeout=60000); await pg.click("#m-save")
        print("download", (await dl.value).suggested_filename, errs)
        await b.close()
asyncio.run(main())
