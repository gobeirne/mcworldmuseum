# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import asyncio, re
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); ctx = await b.new_context(viewport={"width":1300,"height":820}, accept_downloads=True)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:600]))
        await pg.goto("file://" + __import__("os").path.abspath("index.html") + ""); await pg.evaluate("localStorage.clear()"); await pg.reload()
        await pg.set_input_files("#zipInput", ["tests/out/speckle.zip", "tests/out/world.zip"]); await pg.wait_for_timeout(3000)
        # 1. signs hidden by default
        print("1 signs tab visible:", await pg.locator('.tabs [data-tab=signs]').is_visible())
        await pg.click('.tabs [data-tab=world]'); await pg.check("#showSigns"); await pg.wait_for_timeout(100)
        print("  after switching on:", await pg.locator('.tabs [data-tab=signs]').is_visible())
        await pg.uncheck("#showSigns")
        # 2. overlapping areas stay separate (speckle world)
        await pg.select_option("#worldSel", "0"); await pg.wait_for_timeout(300)
        await pg.click("#drawBtn"); await pg.mouse.move(60,120); await pg.mouse.down(); await pg.mouse.move(500,760,steps=5); await pg.mouse.up()
        await pg.click("#drawBtn"); await pg.click("#drawBtn")
        await pg.mouse.move(420,120); await pg.mouse.down(); await pg.mouse.move(905,760,steps=5); await pg.mouse.up(); await pg.click("#drawBtn")
        # 6. per-world undo: make an edit in the other world, come back, undo here only undoes here
        await pg.select_option("#worldSel", "1"); await pg.wait_for_timeout(300)
        await pg.evaluate("__wm.keepPlace(0)")
        await pg.select_option("#worldSel", "0"); await pg.wait_for_timeout(300)
        await pg.click('.tabs [data-tab=exhibits]')
        print("6 world A kept before undo:", await pg.locator('.ex').count())
        await pg.click("#undoBtn"); await pg.wait_for_timeout(200)
        a_after = await pg.evaluate("JSON.parse(Object.entries(localStorage).filter(([k])=>k.startsWith('wm:plan')).map(([k,v])=>[k.includes('Speckle'),JSON.parse(v).exhibits.length]).reduce((o,[s,n])=>(o[s?'A':'B']=n,o),{})|| '{}')") if False else None
        plans = await pg.evaluate("Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('wm:plan')).map(([k,v])=>[k.includes('Speckle')?'speckle':'cushion', JSON.parse(v).exhibits.length]))")
        print("  after one undo in world A:", plans, "(cushion should still have 1)")
        await pg.click("#undoBtn"); await pg.wait_for_timeout(100)   # redo world A's second area back? no: undo again removes area 1? keep both: re-draw instead
        await pg.keyboard.press("Escape")
        # restore both areas for the museum tests
        await pg.click("#drawBtn"); await pg.mouse.move(60,120); await pg.mouse.down(); await pg.mouse.move(500,760,steps=5); await pg.mouse.up(); await pg.click("#drawBtn")
        await pg.click("#drawBtn"); await pg.mouse.move(420,120); await pg.mouse.down(); await pg.mouse.move(905,760,steps=5); await pg.mouse.up(); await pg.click("#drawBtn")
        await pg.click("#arrangeBtn"); await pg.wait_for_timeout(500)
        groups = await pg.locator("#pane-museum [data-g]").all_inner_texts()
        print("2 museum exhibits:", len(groups), [g.split("\n")[0] for g in groups])
        print("  museum undo starts empty:", await pg.is_disabled("#mUndoBtn"))
        # 3+4. drag one speckle exhibit onto the other's main land: build still allowed, bigger wins
        a = await pg.evaluate("__wm.group(0)"); c = await pg.evaluate("__wm.group(1)")
        (ax, ay), (cx, cy) = a["main"], c["main"]
        await pg.mouse.move(cx, cy); await pg.mouse.down(); await pg.mouse.move(ax + 20, ay + 20, steps=8); await pg.mouse.up(); await pg.wait_for_timeout(300)
        t = await pg.inner_text("#pane-museum")
        print("3/4 after dragging main onto main:", (re.findall(r"[\d,]+ chunks? left out where exhibits meet[^.]*", t) or ['nothing left out'])[0], "| build disabled:", await pg.is_disabled("#m-build"))
        await pg.click("#mUndoBtn"); await pg.wait_for_timeout(300)
        t = await pg.inner_text("#pane-museum")
        print("  museum undo of drag:", (re.findall(r"[\d,]+ chunks? left out where exhibits meet", t) or ['nothing left out'])[0])
        # 5. erase part of an exhibit, then undo it
        before = re.findall(r"\d+ exhibits?, ([\d,]+) chunks", await pg.inner_text("#pane-museum"))[0]
        await pg.click("#eraseBtn")
        a = await pg.evaluate("__wm.group(0)"); (ax, ay) = a["main"]
        await pg.mouse.move(ax - 5, ay - 5); await pg.mouse.down(); await pg.mouse.move(ax + 120, ay + 120, steps=6); await pg.wait_for_timeout(100)
        await pg.screenshot(path="tests/out/erase-drag.png")
        await pg.mouse.up(); await pg.wait_for_timeout(300)
        after = re.findall(r"\d+ exhibits?, ([\d,]+) chunks", await pg.inner_text("#pane-museum"))[0]
        print("5 chunks before/after erase:", before, after)
        await pg.click("#eraseBtn")
        await pg.click("#mUndoBtn"); await pg.wait_for_timeout(300)
        print("  after museum undo:", re.findall(r"\d+ exhibits?, ([\d,]+) chunks", await pg.inner_text("#pane-museum"))[0])
        await pg.click("#m-build")
        async with pg.expect_download(timeout=60000) as dl:
            await pg.wait_for_selector("#m-save", timeout=60000); await pg.click("#m-save")
        print("build ok:", (await dl.value).suggested_filename, errs)
        await b.close()
asyncio.run(main())
