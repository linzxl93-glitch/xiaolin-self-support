#!/usr/bin/env python3
"""一次性生成晓霖自我支持工作台的 PWA 图标（纯标准库，无第三方依赖）。"""
import zlib, struct, os

def make_png(path, size, draw):
    px = bytearray(size * size * 4)
    draw(px, size)
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(px[y * stride:(y + 1) * stride])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, os.path.getsize(path), "bytes")

def setpx(px, size, x, y, c):
    if 0 <= x < size and 0 <= y < size:
        i = (y * size + x) * 4
        px[i], px[i + 1], px[i + 2], px[i + 3] = c

def fill_rect(px, size, x0, y0, x1, y1, c):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            setpx(px, size, x, y, c)

def fill_circle(px, size, cx, cy, r, c):
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                setpx(px, size, x, y, c)

def rounded_rect(px, size, x0, y0, x1, y1, r, c):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            if x < x0 + r and y < y0 + r and (x - x0 - r) ** 2 + (y - y0 - r) ** 2 > r * r:
                continue
            if x > x1 - r and y < y0 + r and (x - (x1 - r)) ** 2 + (y - y0 - r) ** 2 > r * r:
                continue
            if x < x0 + r and y > y1 - r and (x - x0 - r) ** 2 + (y - (y1 - r)) ** 2 > r * r:
                continue
            if x > x1 - r and y > y1 - r and (x - (x1 - r)) ** 2 + (y - (y1 - r)) ** 2 > r * r:
                continue
            setpx(px, size, x, y, c)

def draw_icon(px, size, maskable=False):
    bg = (111, 125, 102)
    bg2 = (90, 103, 82)
    for y in range(size):
        t = y / size
        c = (int(bg[0] + (bg2[0] - bg[0]) * t),
             int(bg[1] + (bg2[1] - bg[1]) * t),
             int(bg[2] + (bg2[2] - bg[2]) * t))
        for x in range(size):
            setpx(px, size, x, y, (c[0], c[1], c[2], 255))
    pad = size * 0.22 if maskable else size * 0.15
    cx0, cy0, cx1, cy1 = pad, pad, size - pad, size - pad
    rounded_rect(px, size, cx0, cy0, cx1, cy1, size * 0.10, (255, 253, 249, 255))
    inner_x0 = cx0 + size * 0.09
    inner_x1 = cx1 - size * 0.09
    top = cy0 + size * 0.14
    bottom = cy1 - size * 0.14
    rows = 3
    step = (bottom - top) / rows
    for i in range(rows):
        cyc = top + step * i + step * 0.5
        cr = size * 0.035
        fill_circle(px, size, inner_x0 + cr, cyc, cr, (111, 125, 102, 255))
        ly0, ly1 = cyc - size * 0.018, cyc + size * 0.018
        lx0 = inner_x0 + cr * 2 + size * 0.045
        lx1 = inner_x1
        rounded_rect(px, size, lx0, ly0, lx1, ly1, size * 0.018, (222, 214, 204, 255))

out = os.path.join(os.path.dirname(__file__), "assets", "icons")
os.makedirs(out, exist_ok=True)
make_png(os.path.join(out, "icon-192.png"), 192, lambda p, s: draw_icon(p, s, False))
make_png(os.path.join(out, "icon-512.png"), 512, lambda p, s: draw_icon(p, s, False))
make_png(os.path.join(out, "maskable-512.png"), 512, lambda p, s: draw_icon(p, s, True))
make_png(os.path.join(out, "apple-touch-icon.png"), 180, lambda p, s: draw_icon(p, s, False))
