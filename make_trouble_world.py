# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import os, shutil, struct, random, zipfile, math
from amulet.level.formats.leveldb_world.format import LevelDBFormat
from amulet_nbt import CompoundTag, StringTag, IntTag, ListTag, FloatTag, ByteTag, LongTag, NamedTag
import leveldb

os.makedirs("tests/out", exist_ok=True)
p = "tests/out/Ab12Cd34ef0=/"
shutil.rmtree(p, ignore_errors=True)
f = LevelDBFormat(p)
f.create_and_open("bedrock", (1, 20, 0))
f.level_name = "Cushion Society"
f.save(); f.close()

db = leveldb.LevelDB(p + "db", create_if_missing=True)
def ck(x, z, tag, dim=0, sub=None):
    k = struct.pack("<ii", x, z) + (struct.pack("<i", dim) if dim else b"") + bytes([tag])
    if sub is not None: k += struct.pack("<b", sub)
    return k
def nbt(c): return NamedTag(c).to_nbt(compressed=False, little_endian=True)

random.seed(1)
HOUSE = {(x, z) for x in range(-6, -3) for z in range(8, 11)}
VILLAGE = {(x, z) for x in range(10, 14) for z in range(-12, -9)}
TUNNEL = {(x, 0) for x in range(-12, 6)}
def sub(names, y):
    out = bytes([9, 1, y & 0xff])
    bits = max(1, (len(names) - 1).bit_length())
    vpw = 32 // bits; words = -(-4096 // vpw)
    out += bytes([bits << 1]) + os.urandom(words * 4) + struct.pack("<i", len(names))
    for n in names:
        out += nbt(CompoundTag({"name": StringTag("minecraft:" + n), "states": CompoundTag({}), "version": IntTag(18100737)}))
    return out
truth = {}
for cx in range(-20, 21):
    for cz in range(-20, 21):
        h = []
        for z in range(16):
            for x in range(16):
                wx, wz = cx*16+x, cz*16+z
                y = int(64 + 20*math.sin(wx/40) * math.cos(wz/55))
                h.append(y + 64)  # stored relative to world bottom
        biome = 0 if h[0] - 64 < 60 else (1 if cx < 0 else 4)
        d3 = struct.pack("<256h", *h) + bytes([1]) + struct.pack("<i", biome) + b"\xff" * 23
        db.put(ck(cx, cz, 43), d3)
        db.put(ck(cx, cz, 44), bytes([40]))
        for s in range(-4, 6):
            names = ["air", "stone", "dirt", "grass_block"]
            if (cx, cz) in HOUSE and s == 0: names += ["oak_planks", "glass", "oak_stairs", "torch", "white_wool", "oak_door"]
            if (cx, cz) in VILLAGE and s == 0: names += ["oak_planks", "cobblestone", "oak_stairs", "oak_door", "glass_pane", "torch"]
            if (cx, cz) in TUNNEL and s == -3: names += ["torch"]
            if (cx, cz) == (15, 15) and s == 3: names += ["sand", "sandstone"]
            db.put(ck(cx, cz, 47, sub=s), sub(names, s))
        truth[(cx, cz)] = (h[0]-64, biome)
# a base with signs, chests, named wolf
bes = [
  CompoundTag({"id": StringTag("Sign"), "x": IntTag(100), "y": IntTag(70), "z": IntTag(40),
     "FrontText": CompoundTag({"Text": StringTag("Wet Grass Kingdom Centre")})}),
  CompoundTag({"id": StringTag("Chest"), "x": IntTag(101), "y": IntTag(70), "z": IntTag(41), "Items": ListTag([CompoundTag({"Count": ByteTag(3), "Name": StringTag("minecraft:diamond")})])}),
  CompoundTag({"id": StringTag("Chest"), "x": IntTag(102), "y": IntTag(30), "z": IntTag(42), "LootTable": StringTag("loot_tables/chests/simple_dungeon.json")}),
]
db.put(ck(6, 2, 49), b"".join(nbt(b) for b in bes))
db.put(ck(-15, -15, 49), nbt(CompoundTag({"id": StringTag("Sign"), "x": IntTag(-235), "y": IntTag(12), "z": IntTag(-235), "Text": StringTag("Amazing cave complex below!")})))
db.put(ck(-15, -14, 49), nbt(CompoundTag({"id": StringTag("Sign"), "x": IntTag(-235), "y": IntTag(12), "z": IntTag(-220), "Text": StringTag("old text")})))
wolf = CompoundTag({"identifier": StringTag("minecraft:wolf"), "Pos": ListTag([FloatTag(103.5), FloatTag(70), FloatTag(44.2)]), "CustomName": StringTag("Biscuit"), "OwnerNew": LongTag(-4294967295)})
db.put(b"actorprefix" + struct.pack("<q", 77), nbt(wolf))
db.put(b"digp" + struct.pack("<ii", 6, 2), struct.pack("<q", 77))
db.put(ck(11, -11, 49), nbt(CompoundTag({"id": StringTag("Bell"), "x": IntTag(180), "y": IntTag(70), "z": IntTag(-170)})))
# nether build
db.put(ck(3, 3, 43, dim=1), struct.pack("<256h", *[128]*256) + bytes([1]) + struct.pack("<i", 8) + b"\xff"*7)
db.put(ck(3, 3, 49, dim=1), nbt(CompoundTag({"id": StringTag("Sign"), "x": IntTag(50), "y": IntTag(70), "z": IntTag(50), "FrontText": CompoundTag({"Text": StringTag("Nether hub")})})))
db.put(ck(3, 3, 47, dim=1, sub=4), sub(['air','netherrack'],4)); db.put(ck(3, 3, 44, dim=1), bytes([40]))
db.put(ck(6, 2, 66), b"\x01\x02future-format-data")
db.put(ck(5, 3, 49), b"\x0a\x00\x00\x08\x02\x00id\xff\xff")   # broken block-entity record
db.put(b"digp" + struct.pack("<ii", 5, 1), struct.pack("<q", 999))     # lists a mob with no data
db.compact()
# later edits that stay in the log: overwrite and delete
db.put(ck(-15, -14, 49), nbt(CompoundTag({"id": StringTag("Sign"), "x": IntTag(-235), "y": IntTag(12), "z": IntTag(-220), "Text": StringTag("Biome Boundary Bridge")})))
db.put(ck(-15, -15, 49), nbt(CompoundTag({"id": StringTag("Sign"), "x": IntTag(-235), "y": IntTag(12), "z": IntTag(-235), "Text": StringTag("Amazing cave complex below!")})))
db.delete(ck(20, 20, 43))
db.put(b"~local_player", nbt(CompoundTag({"Pos": ListTag([FloatTag(99.0), FloatTag(71.6), FloatTag(39.0)]), "DimensionId": IntTag(0)})))
db.close()
os.system(f"ls -la {p}db")
z = zipfile.ZipFile("tests/out/trouble.zip", "w", zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(p):
    for fn in files:
        full = os.path.join(root, fn)
        z.write(full, os.path.relpath(full, "tests/out"))
z.close()
