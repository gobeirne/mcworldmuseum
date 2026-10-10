# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
# Copyright (c) 2026 Greg O'Beirne
import os, shutil, struct, random, zipfile
from amulet.level.formats.leveldb_world.format import LevelDBFormat
from amulet_nbt import CompoundTag, StringTag, IntTag, NamedTag
import leveldb
os.makedirs("tests/out", exist_ok=True)
p = "tests/out/Spk0000000=/"
shutil.rmtree(p, ignore_errors=True)
f = LevelDBFormat(p); f.create_and_open("bedrock", (1, 20, 0)); f.level_name = "Speckle Land"; f.save(); f.close()
db = leveldb.LevelDB(p + "db", create_if_missing=True)
def ck(x, z, tag, sub=None):
    k = struct.pack("<ii", x, z) + bytes([tag]); return k + (struct.pack("<b", sub) if sub is not None else b"")
def nbt(c): return NamedTag(c).to_nbt(compressed=False, little_endian=True)
def subc(y):
    names=["air","stone","grass_block"]; out=bytes([9,1,y&0xff, 2<<1]) + bytes(4*256) + struct.pack("<i",len(names))
    for n in names: out+=nbt(CompoundTag({"name":StringTag("minecraft:"+n),"states":CompoundTag({}),"version":IntTag(18100737)}))
    return out
random.seed(3)
land=set()
for x in range(0,10):
    for z in range(0,10): land.add((x,z)); land.add((x+14,z))
spk=set()
for (ax,az) in [(0,0),(14,0)]:
    for _ in range(40):
        x=random.randint(ax-4,ax+13); z=random.randint(az-4,az+13)
        if (x,z) in land: continue
        if any((x+dx,z+dz) in land for dx in (-1,0,1) for dz in (-1,0,1)): continue
        spk.add((x,z))
# bigger islands (3x3) near each land, not touching it
isl=set()
for (ix,iz) in [(-5,3),(11,-5),(19,11),(25,2)]:
    for dx in range(3):
        for dz in range(3): isl.add((ix+dx,iz+dz))
isl -= land
spk -= {(x+dx,z+dz) for (x,z) in isl for dx in (-1,0,1) for dz in (-1,0,1)}
for (x,z) in land|spk|isl:
    db.put(ck(x,z,43), struct.pack("<256h",*[64+70]*256) + bytes([1]) + struct.pack("<i",1) + b"\xff"*23)
    db.put(ck(x,z,44), bytes([40]))
    for s in range(-4,5): db.put(ck(x,z,47,s), subc(s))
db.compact(); db.close()
print("land", len(land), "speckle", len(spk), "islands", len(isl))
z = zipfile.ZipFile("tests/out/speckle.zip", "w", zipfile.ZIP_DEFLATED)
for root, _, files in os.walk(p):
    for fn in files:
        full = os.path.join(root, fn); z.write(full, os.path.relpath(full, "/home/claude/test"))
z.close()
