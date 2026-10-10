# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio, re, json
from playwright.async_api import async_playwright
URL = "file://" + __import__("os").path.abspath("index.html")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1300,"height":820}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:300]))
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", ["tests/out/world.zip", "tests/out/speckle.zip"]); await pg.wait_for_timeout(3000)
        for i in range(2): await pg.evaluate(f"__wm.keepPlace({i})")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(400)
        await pg.check("#m-hub"); await pg.wait_for_timeout(100); await pg.mouse.click(120, 700); await pg.wait_for_timeout(200)
        await pg.click("#eraseBtn"); a = await pg.evaluate("__wm.group(0)"); (ax, ay) = a["main"]
        await pg.mouse.move(ax-5, ay-5); await pg.mouse.down(); await pg.mouse.move(ax+60, ay+60, steps=4); await pg.mouse.up(); await pg.click("#eraseBtn"); await pg.wait_for_timeout(300)
        summary = lambda t: (re.findall(r"\d+ exhibits?, [\d,]+ chunks", t) or ['?'])[0] + (" | hub " + re.findall(r"The hub is at (X -?\d+, Z -?\d+)", t)[0] if "The hub is at" in t else " | no hub")
        before = summary(await pg.inner_text("#pane-museum")); print("before reload :", before)
        async with pg.expect_download() as dl: await pg.click("#m-saveplan")
        await (await dl.value).save_as("tests/out/plan.json")
        await pg.wait_for_timeout(400)
        # 1. reload, choose both ZIPs again
        await pg.reload(); await pg.wait_for_timeout(300)
        print("card        :", (await pg.inner_text("#resume")).replace("\n", " / ")[:160])
        await pg.set_input_files("#zipInput", ["tests/out/speckle.zip", "tests/out/world.zip"]); await pg.wait_for_timeout(3500)
        print("resumed to museum:", await pg.evaluate("document.body.classList.contains('museum')"), "|", summary(await pg.inner_text("#pane-museum")))
        # 2. reload, only one ZIP, continue with 1 of 2
        await pg.reload(); await pg.wait_for_timeout(300)
        await pg.set_input_files("#zipInput", ["tests/out/speckle.zip"]); await pg.wait_for_timeout(2000)
        print("partial card:", (await pg.inner_text("#resume")).replace("\n", " / ")[:200])
        await pg.click("#resumeGo"); await pg.wait_for_timeout(800)
        t = await pg.inner_text("#pane-museum"); print("waiting note:", re.findall(r"Not loaded: [^.]*\.", t))
        # 3. played-since copy
        await pg.reload(); await pg.wait_for_timeout(300)
        await pg.set_input_files("#zipInput", ["tests/out/speckle.zip", "tests/out/world-played.zip"]); await pg.wait_for_timeout(3500)
        print("played-since toast:", await pg.inner_text("#toast"))
        # 4. wipe the browser, open the plan file, then the ZIPs
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(300)
        print("after wipe, card shown:", bool((await pg.inner_text("#resume")).strip()))
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.set_input_files("#planInput", "tests/out/plan.json"); await pg.wait_for_timeout(500)
        print("after plan file, card:", (await pg.inner_text("#resume")).split("\n")[0])
        await pg.set_input_files("#zipInput", ["tests/out/speckle.zip", "tests/out/world.zip"]); await pg.wait_for_timeout(3500)
        print("restored from file:", summary(await pg.inner_text("#pane-museum")))
        print(errs); await b.close()
asyncio.run(main())
