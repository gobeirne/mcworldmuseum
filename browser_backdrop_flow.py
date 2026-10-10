# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio, zipfile, io, re, shutil
from playwright.async_api import async_playwright
URL = "file://" + __import__("os").path.abspath("index.html")
async def build_and_save(pg, path):
    await pg.click("#m-build")
    async with pg.expect_download(timeout=90000) as dl:
        await pg.wait_for_selector("#m-save", timeout=90000); await pg.click("#m-save")
    await (await dl.value).save_as(path)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1300,"height":820}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:300]))
        # 1. first museum, with a hub
        await pg.goto(URL); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", "tests/out/world.zip"); await pg.wait_for_timeout(2000)
        for i in range(2): await pg.evaluate(f"__wm.keepPlace({i})")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(300)
        await pg.fill("#m-name", "First Museum"); await pg.press("#m-name", "Tab")
        await pg.check("#m-hub"); await pg.mouse.click(120, 700); await pg.wait_for_timeout(300)
        await build_and_save(pg, "tests/out/museum1.zip"); print("museum 1 built")
        # 2. new session: the first museum + a new world
        await pg.evaluate("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(200)
        await pg.set_input_files("#zipInput", ["tests/out/museum1.zip", "tests/out/speckle.zip"]); await pg.wait_for_timeout(4000)
        print("toast:", (await pg.inner_text("#toast"))[:90])
        await pg.select_option("#worldSel", "1"); await pg.wait_for_timeout(300)
        await pg.click("#drawBtn"); await pg.mouse.move(100,150); await pg.mouse.down(); await pg.mouse.move(400,500,steps=4); await pg.mouse.up(); await pg.click("#drawBtn")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(600)
        t = await pg.inner_text("#pane-museum")
        print("panel:", re.findall(r"Backdrop: [^\n]*", t), re.findall(r"\d+ exhibits?, [\d,]+ chunks", t))
        await pg.screenshot(path="tests/out/backdrop-1.png")
        # drag the new exhibit onto the backdrop, then bring it to top (it wins anyway)
        g = await pg.evaluate("(()=>{for(let i=0;i<10;i++){try{const r=__wm.group(i); if(!r.id.startsWith('backdrop')) return r;}catch(e){return null}} })()")
        (gx, gy) = g["main"]
        await pg.mouse.move(gx, gy); await pg.mouse.down(); await pg.mouse.move(450, 330, steps=10); await pg.mouse.up(); await pg.wait_for_timeout(300)
        t = await pg.inner_text("#pane-museum")
        print("after drag:", re.findall(r"[\d,]+ chunks? left out where exhibits meet[^.]*", t) or "nothing left out")
        await pg.click("[data-top]"); await pg.wait_for_timeout(200)
        print("on top:", await pg.inner_text("[data-top]"))
        await pg.check("#m-hub"); await pg.mouse.click(1000 - 900, 760); await pg.wait_for_timeout(300)
        t = await pg.inner_text("#pane-museum")
        print("hub section:", re.findall(r"The backdrop already has a hub[^\n]*", t)[:1])
        await pg.screenshot(path="tests/out/backdrop-2.png")
        await pg.fill("#m-name", "Second Museum"); await pg.press("#m-name", "Tab")
        await build_and_save(pg, "tests/out/museum2.zip")
        print("result:", (await pg.inner_text("#m-result")).split("\n")[1][:200])
        print(errs); await b.close()
asyncio.run(main())
