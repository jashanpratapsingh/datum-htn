#!/usr/bin/env python3
"""
Decode the badge's `shot` output into a PNG.

Wire format, reverse-engineered from the device (the firmware documents only
"Stream the screen as RLE+base64 RGB565"):

    SHOT <w> <h> rgb565le rle1
    S <x0> <y0> <x1> <y1>          one stripe, 30 rows tall
    <base64>...                     RLE payload, 76-char lines
    ... repeated per stripe ...
    END bytes=<b64 chars> raw=<w*h*2> crc32=<hex> stripes=<n> covered=<px> elapsed_ms=<n>

`rle1` is byte-oriented over the little-endian RGB565 stream:

    n & 0x80  -> RUN:     repeat the next 2-byte pixel (n & 0x7f) + 2 times
    n & ~0x80 -> LITERAL: copy the next (n + 1) pixels verbatim

The run bias is **+2**, not +1 — a run of 1 would cost the same as a literal,
so the encoder never emits one. Verified: all 8 stripes decode to exactly
320*30*2 bytes.

Writes a PNG with no third-party imaging deps (zlib + a hand-rolled chunk writer).
"""
import base64, struct, sys, zlib


def parse(text):
    lines = [l for l in text.split("\n") if l.strip()]
    hdr = next(l for l in lines if l.startswith("SHOT ")).split()
    W, H = int(hdr[1]), int(hdr[2])
    stripes, cur = [], None
    for l in lines[lines.index(" ".join(hdr)) + 1:]:
        if l.startswith("S "):
            if cur:
                stripes.append(cur)
            cur = {"hdr": [int(x) for x in l.split()[1:]], "b": []}
        elif l.startswith("END"):
            break
        elif cur is not None:
            cur["b"].append(l.strip())
    if cur:
        stripes.append(cur)
    return W, H, stripes


def unrle(d):
    o = bytearray()
    i = 0
    while i < len(d) - 1:
        n = d[i]
        if n & 0x80:
            cnt = (n & 0x7F) + 2
            i += 1
            o += d[i:i + 2] * cnt
            i += 2
        else:
            cnt = n + 1
            i += 1
            o += d[i:i + 2 * cnt]
            i += 2 * cnt
    return bytes(o)


def to_rgb(raw, w, h):
    """RGB565 little-endian -> RGB888, expanding by bit-replication so whites
    reach 0xFF rather than 0xF8."""
    out = bytearray(w * h * 3)
    for p in range(w * h):
        v = raw[2 * p] | (raw[2 * p + 1] << 8)
        r = (v >> 11) & 0x1F
        g = (v >> 5) & 0x3F
        b = v & 0x1F
        out[3 * p] = (r << 3) | (r >> 2)
        out[3 * p + 1] = (g << 2) | (g >> 4)
        out[3 * p + 2] = (b << 3) | (b >> 2)
    return out


def png(path, w, h, rgb):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    rows = b"".join(b"\x00" + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(rows, 9)))
        f.write(chunk(b"IEND", b""))


def decode(text):
    W, H, stripes = parse(text)
    fb = bytearray(W * H * 2)
    for s in stripes:
        d = b"".join(base64.b64decode(x + "=" * (-len(x) % 4)) for x in s["b"])
        raw = unrle(d)
        x0, y0, x1, y1 = s["hdr"]
        sw = x1 - x0 + 1
        for row in range(y1 - y0 + 1):
            src = row * sw * 2
            dst = ((y0 + row) * W + x0) * 2
            fb[dst:dst + sw * 2] = raw[src:src + sw * 2]
    return W, H, to_rgb(fb, W, H)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "badge-screen.png"
    if len(sys.argv) > 2:
        text = open(sys.argv[2]).read()
    else:
        sys.path.insert(0, "scripts")
        from badge import Badge
        b = Badge(boot_wait=4.0)
        text = b.cmd("shot", timeout=45)
        b.close()
    W, H, rgb = decode(text)
    png(out, W, H, rgb)
    print(f"wrote {out} ({W}x{H})")
