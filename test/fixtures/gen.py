"""Writes sample.aseprite: one of each chunk type, built from the public spec.

Usage: python gen.py sample.aseprite
"""
import struct, sys, zlib, uuid

def s(text):
    b = text.encode("utf-8")
    return struct.pack("<H", len(b)) + b

def chunk(ctype, data):
    return struct.pack("<IH", len(data) + 6, ctype) + data

W, H = 8, 8
import os
uuid_flag = 0 if os.environ.get("NO_UUID") else 4
chunks0 = []

# Color profile: sRGB
chunks0.append(chunk(0x2007, struct.pack("<HHi", 1, 0, 0) + bytes(8)))
# External files: one tileset extension
chunks0.append(chunk(0x2008, struct.pack("<I", 1) + bytes(8) + struct.pack("<IB", 7, 2) + bytes(7) + s("example/Props")))
# New palette: 4 colors, last one named
pal = struct.pack("<III", 4, 0, 3) + bytes(8)
for i, (r, g, b, a) in enumerate([(0, 0, 0, 255), (255, 0, 0, 255), (0, 255, 0, 128), (0, 0, 255, 255)]):
    pal += struct.pack("<HBBBB", 1 if i == 3 else 0, r, g, b, a) + (s("Sky") if i == 3 else b"")
chunks0.append(chunk(0x2019, pal))
# Old palette (0x0004): one packet, 2 colors
chunks0.append(chunk(0x0004, struct.pack("<HBB", 1, 0, 2) + bytes([0, 0, 0, 255, 0, 0])))
# Sprite user data: text + color
chunks0.append(chunk(0x2020, struct.pack("<I", 3) + s("hello") + bytes([10, 20, 30, 255])))

def layer(flags, ltype, level, name, extra=b""):
    return chunk(0x2004, struct.pack("<HHHHHHB", flags, ltype, level, 0, 0, 0, 255) + bytes(3) + s(name) + extra + (uuid.UUID(int=len(name)).bytes if uuid_flag else b""))

chunks0.append(layer(3, 0, 0, "Background"))
chunks0.append(layer(3 | 32, 1, 0, "Group"))
chunks0.append(layer(3, 0, 1, "Child"))
chunks0.append(layer(3, 2, 0, "Tiles", struct.pack("<I", 0)))
# Layer user data: properties map with a bool and an int32
props = struct.pack("<II", 0, 2) + s("solid") + struct.pack("<HB", 1, 1) + s("hp") + struct.pack("<Hi", 6, 100)
chunks0.append(chunk(0x2020, struct.pack("<I", 4) + struct.pack("<II", 8 + len(props), 1) + props))

# Tileset: 2 tiles of 4x4 RGBA, embedded
tiles = zlib.compress(bytes([255, 255, 255, 255] * 16 + [0, 0, 0, 255] * 16))
chunks0.append(chunk(0x2023, struct.pack("<IIIHHh", 0, 2 | 4, 2, 4, 4, 1) + bytes(14) + s("Ground") + struct.pack("<I", len(tiles)) + tiles))

def cel(layer_index, x, y, ctype, body):
    return chunk(0x2005, struct.pack("<HhhBHh", layer_index, x, y, 255, ctype, 0) + bytes(5) + body)

pixels = bytes([(x * 32) & 255 for x in range(W * H * 4)])
chunks0.append(cel(0, 0, 0, 2, struct.pack("<HH", W, H) + zlib.compress(pixels)))
chunks0.append(chunk(0x2006, struct.pack("<Iiiii", 1, 1 << 15, 2 << 16, W << 16, H << 16) + bytes(16)))
chunks0.append(cel(2, 1, 1, 0, struct.pack("<HH", 2, 2) + bytes(range(16))))
tilemap = zlib.compress(struct.pack("<4I", 1, 2, 0x80000001, 0))
chunks0.append(cel(3, 0, 0, 3, struct.pack("<HHHIIII", 2, 2, 32, 0x1FFFFFFF, 0x80000000, 0x40000000, 0x20000000) + bytes(10) + tilemap))

# Tags + one user data per tag
tags = struct.pack("<H", 2) + bytes(8)
tags += struct.pack("<HHBH", 0, 1, 2, 0) + bytes(6) + bytes([255, 0, 0, 0]) + s("walk")
tags += struct.pack("<HHBH", 1, 1, 0, 3) + bytes(6) + bytes([0, 255, 0, 0]) + s("idle")
chunks0.append(chunk(0x2018, tags))
chunks0.append(chunk(0x2020, struct.pack("<I", 2) + bytes([255, 0, 0, 255])))
chunks0.append(chunk(0x2020, struct.pack("<I", 0)))

# Slice with 9-patch and pivot
chunks0.append(chunk(0x2022, struct.pack("<III", 1, 3, 0) + s("button") + struct.pack("<IiiII", 0, 0, 0, W, H) + struct.pack("<iiII", 2, 2, 4, 4) + struct.pack("<ii", 4, 8)))

# Mask (deprecated) 3x2
chunks0.append(chunk(0x2016, struct.pack("<hhHH", 0, 0, 3, 2) + bytes(8) + s("mask") + bytes([0xA0, 0x40])))

def frame(chunks, duration, old_style):
    # Aseprite writes the count to both fields; very old files only fill the WORD.
    data = b"".join(chunks)
    old = len(chunks)
    new = 0 if old_style else len(chunks)
    return struct.pack("<IHHH", 16 + len(data), 0xF1FA, old, duration) + bytes(2) + struct.pack("<I", new) + data

old_style = len(sys.argv) > 2
frames = [frame(chunks0, 100, False)]
# Second frame: a linked cel
frames.append(frame([cel(0, 0, 0, 1, struct.pack("<H", 0))], 150, old_style))

body = b"".join(frames)
header = struct.pack("<IHHHHHIHIIB", 128 + len(body), 0xA5E0, len(frames), W, H, 32, 1 | 2 | uuid_flag, 100, 0, 0, 0)
header += bytes(3) + struct.pack("<HBBhhHH", 4, 1, 1, 0, 0, 16, 16) + bytes(84)
assert len(header) == 128
open(sys.argv[1], "wb").write(header + body)
print(len(header + body), "bytes")
