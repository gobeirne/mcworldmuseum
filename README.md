# World Museum

Turn a pile of old Minecraft Bedrock worlds into one small "museum" world: the places you remember, each kept intact from bedrock to sky, set in surroundings you choose with a little space between them.

Everything runs in the browser. Worlds are read and written on your own device; nothing is uploaded.

**Use it here: https://gobeirne.github.io/mcworldmuseum/** (phones and computers).

## Using it

Open https://gobeirne.github.io/mcworldmuseum/ in a current browser (Safari, Chrome, Edge or Firefox), or open `index.html` from this repository.

1. **Open worlds.** Choose world ZIPs, a ZIP of the whole `minecraftWorlds` folder, or (on a computer) a world folder. On iPhone: in Files, long-press a world folder, tap Compress, then pick the ZIP.
2. **Survey.** An overhead map shows every saved chunk. Red shading marks chunks containing crafted blocks. Signs show as markers, with a searchable Signs tab. Optional numbered pins mark the places with the most building evidence; they're off by default and switched on in the World tab, as is hiding signs.
3. **Keep.** Use Draw area to outline somewhere, guided by the red shading (or, with pins on, tap a pin and choose Keep). Set each exhibit's landscape margin, and how much to smooth its edges: smoothing only ever removes chunks, at most n deep, never ones with building evidence, trimming the speckled fringe of half-explored land and rounding corners. Every kept area is its own exhibit; where two overlap, the bigger one keeps the shared chunks. Undo is kept per world, and the plan is saved in the browser.
4. **Arrange museum.** Exhibits are packed with the gap you choose; drag to rearrange. Where exhibits meet, the bigger landmass wins: smaller pieces lose any chunks that would overlap it or sit within the gap, so Build is never blocked. Erase area removes chunks directly on the museum map (with its own undo). Pick the surroundings: ocean, warm ocean, frozen ocean, grassy plains, desert, mushroom fields, void, or normal terrain from a seed (with no blending at exhibit edges). A world's own seed can keep that world's exhibits at their original spots so the land around them matches. With Ocean, Warm ocean, Desert or Void, edges can also be cut as smooth curves block by block: a few blocks of the outermost chunks are replaced with the surroundings' own layers, never in columns holding crafted blocks.
5. **Transporter hub (optional).** Place a hub anywhere on the museum map. It gets a station for each destination (each world's spawn, your last position, or both, plus the centre of any exhibit holding neither): a command block at ground level with a button on its front and a labelled sign on top. Each destination gets a "Back to the hub" station beside it. On open surroundings the hub sits on a stone platform, ready to build a temple around. Standing where you want a transporter before zipping a world makes that your "last visited" destination.
6. **Build the world** and save the `.mcworld`. Opening it imports it into Minecraft. The Build tab's directory lists where every exhibit, each world's spawn and your last position ended up, with teleport commands; it is also saved inside the world as `museum-directory.txt`.

## Preservation report

Every build produces a report, shown before and after building and saved inside the world as `museum-report.txt` and `museum-report.json` (machine-readable, for comparing builds). Items have three severities:

- **Information:** expected behaviour, such as maps and portal links from exhibit worlds not being imported, or chunks you chose to trim, erase or let a bigger exhibit cover.
- **Warning:** unfamiliar data (an unknown chunk record type, copied unchanged), or a part of the format written from current understanding rather than a confirmed round trip through Minecraft. Each such assumption is named while it applies.
- **Preservation loss:** something the tool meant to keep that didn't make it, such as a record that couldn't be moved safely and was left out rather than written with wrong positions.

After writing, the tool **re-reads the finished world from the saved file** and compares it with what it meant to write: every record's contents, every block section, signs' text and containers' contents at their new positions, mobs' positions and unique IDs, the player, and world settings. Mismatches are reported as preservation loss. The developer tests include deliberately sabotaged builds to prove the self-check catches damage.

## Coming back later

Every choice is saved in the browser as you go. When you return, the opening screen lists the worlds you were using: choose the same ZIPs again (renamed ZIPs still match) and you land back where you left off. Worlds played since your plan are recognised and flagged, and their plans still apply. Missing worlds can wait; their exhibits stay saved and are left out until you add them. **Save plan file** keeps every choice (not the worlds) in a small file, as a backup or to move a museum to another device.

## Adding to a museum you've already built

Every museum carries a small marker recording what it is. Export it from Minecraft (with anything you've built in it since) and open it alongside a new world: it's recognised and becomes the **backdrop**: carried over as the base world, including its terrain, builds and world-wide data (maps, portals, villages, scoreboards), fixed in place, with its settings, spawn and your player unchanged. Two things don't survive: records marking structure spawn areas (witch huts and similar), and whatever new exhibits cover. Keep areas in the new world and drag them onto blank parts of the backdrop; new exhibits always go on top, and the panel warns when they cover anything built. Any world can be made the backdrop from the World tab. **Bring to top** gives any exhibit priority over others where they meet. A new transporter hub can be added: it gets a station back to the original hub, and the original gets one station leading to it.

## How it works

- `src/core.js` reads ZIPs, Mojang's LevelDB variant (raw-zlib blocks, manifests, logs), little-endian NBT and chunk records, then scores chunks for building evidence (crafted block types from subchunk palettes, signs, opened chests, item frames, redstone, named or tamed mobs).
- `src/build.js` packs exhibits, copies their chunk records to new coordinates, shifts coordinates inside block entities, entities and tick lists, keeps entity IDs from different worlds apart, writes new LevelDB tables, a manifest and `level.dat` (flat presets or a seed), and streams the result into a ZIP.
- `src/step2.js` is selection, margins and undo. `src/step3.js` is arranging, building and saving. `src/template.html` is the page and map.

`python3 build.py` assembles `src/` into the single self-contained `index.html`. Edit `src/`, then rebuild.

## Tests

`tests/` builds a synthetic Bedrock world with Mojang-format LevelDB, scans it, builds a museum and writes it back out. Requires Node 18+ and Python with `amulet-core` and `amulet-leveldb`.

```
python3 tests/make_test_world.py
node tests/scan_world.js
node tests/build_museum.js
node tests/cut_edges.js
node tests/hub_blocks.js
python3 tests/make_trouble_world.py
node tests/preservation_report.js
node tests/self_check_sabotage.js
```

## Planned

- **Linked Nether portals.** An optional per-exhibit setting that keeps the Nether area around an exhibit's portal and moves it in step (Overworld moves snapped to 128-block steps, Nether moves 1/8 of that), carrying portal records across so existing portal pairs keep working.
- **Softer edges.** Filler chunks written around each exhibit, such as beaches or a ring of the exhibit's own biome.
- **Filling gaps with real terrain.** Highlight unexplored holes inside kept areas and give a route (or teleport commands) to visit them in a copy of the original world, so Minecraft generates them from that world's own seed.

## Limitations

- Bedrock Edition only.
- Building detection is a heuristic. Pure digging and builds made entirely of natural blocks don't show up; villages and other generated structures do, and are labelled as possibly generated.
- Nether and End exhibits go into the museum's own Nether and End, where new terrain generates normally.
- Maps, portal links, village records and scoreboards from exhibit worlds aren't carried over (a backdrop keeps its own).
- Not yet tested against many real worlds or game versions. Keep your originals.

## License

Copyright (c) 2026 Greg O'Beirne. Released under the [Mozilla Public License 2.0](LICENSE): you can use, share and adapt it, including inside larger projects, as long as changes to these files stay open under the same licence.

## Credits

Designed by Greg O'Beirne.

- Typefaces: [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) and [Atkinson Hyperlegible](https://fonts.google.com/specimen/Atkinson+Hyperlegible), both under the SIL Open Font License, loaded from Google Fonts.
- The developer tests use [Amulet](https://github.com/Amulet-Team) to create test worlds and check the output. Amulet is not part of the tool itself.
- All world-reading and world-writing code is original, written from publicly documented descriptions of the Bedrock world format.

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT. Minecraft is a trademark of Mojang Synergies AB.
