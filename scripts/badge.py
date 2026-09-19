#!/usr/bin/env python3
"""
VENDX badge bridge — talk to a Hack the North ESP32-C3 badge over its serial console.

The badge exposes a REPL (`help` lists it) with ls/cat/put/rm/mkdir/reload/apps,
plus `press`, `shot`, `radio` and `snapshot`. Lua apps live in
/littlefs/apps/<slug>/{manifest.cfg,main.lua} and `reload` picks them up with no
reboot and no reflash.

Everything here is additive: we never erase flash and never touch the factory
partition. See docs/BADGE.md.

Usage:
  badge.py cmd  <command>...            run console commands
  badge.py push <localdir> <slug>       install/update a Lua app
  badge.py rm   <slug>                  remove an installed app
"""
import sys, time, os
import serial

PORT = os.environ.get("VENDX_BADGE_PORT", "/dev/cu.usbmodem101")
BAUD = 115200
PROMPT = b"badge> "


class Badge:
    def __init__(self, port=PORT, boot_wait=3.0):
        self.s = serial.Serial(port, BAUD, timeout=0.3)
        # Do NOT toggle DTR/RTS high: on USB-Serial/JTAG that resets the chip.
        self.s.setDTR(False)
        self.s.setRTS(False)
        time.sleep(boot_wait)
        self.s.reset_input_buffer()
        self._sync()

    def _read_until_prompt(self, timeout=8.0):
        """Read until the console prompt reappears. The prompt is the only
        reliable framing here — fixed sleeps desync as soon as the badge is
        busy (LVGL redraw, BLE work) and then every later command misreads."""
        end = time.time() + timeout
        buf = b""
        while time.time() < end:
            chunk = self.s.read(4096)
            if chunk:
                buf += chunk
                if buf.rstrip().endswith(PROMPT.strip()):
                    break
            time.sleep(0.02)
        return buf.decode("utf8", "replace").replace("\r", "")

    def _sync(self):
        self.s.write(b"\r\n")
        self._read_until_prompt(4.0)

    def cmd(self, c, timeout=8.0):
        self.s.reset_input_buffer()
        self.s.write(c.encode() + b"\r\n")
        out = self._read_until_prompt(timeout)
        lines = [l for l in out.split("\n")]
        if lines and lines[0].strip() == c.strip():
            lines = lines[1:]
        return "\n".join(l for l in lines if l.strip() != "badge>").strip()

    def put(self, path, data: bytes, timeout=20.0):
        """Upload raw bytes. The console consumes exactly len(data) bytes after
        the command line, so the payload must be sent verbatim — no newline
        translation, and the declared size must match the bytes sent exactly or
        the remainder spills into the REPL as garbage commands."""
        self.s.reset_input_buffer()
        self.s.write(f"put {path} {len(data)}\r\n".encode())
        time.sleep(0.4)
        self.s.read(8192)
        # 64-byte writes match the USB-CDC packet size; larger bursts overrun.
        for i in range(0, len(data), 64):
            self.s.write(data[i:i + 64])
            self.s.flush()
        out = self._read_until_prompt(timeout)
        ok = f"OK {len(data)}" in out
        return ok, out.strip()

    def size_of(self, path):
        d, base = path.rsplit("/", 1)
        for line in self.cmd(f"ls {d}").split("\n"):
            p = line.split()
            if len(p) >= 3 and p[2] == base:
                return int(p[1])
        return None

    def close(self):
        self.s.close()


def push_app(b: Badge, localdir, slug):
    base = f"/littlefs/apps/{slug}"
    main = open(os.path.join(localdir, "main.lua"), "rb").read()
    man = open(os.path.join(localdir, "manifest.cfg"), "rb").read()
    if len(main) > 64 * 1024:
        raise SystemExit(f"main.lua is {len(main)}B; badge limit is 64 KiB")

    b.cmd("mkdir " + base)
    # Remove first: an installed app holds main.lua open, and writing over it
    # yields a 0-byte file with no error.
    b.cmd(f"rm {base}/main.lua")
    b.cmd(f"rm {base}/manifest.cfg")

    for name, blob in (("main.lua", main), ("manifest.cfg", man)):
        b.put(f"{base}/{name}", blob)
        print(f"  {name:14s} {len(blob):6d}B sent")

    # LittleFS directory metadata is not visible to `ls` in the same console
    # session that wrote it — sizes read back as 0 or missing until the badge
    # syncs. Reboot, then verify for real. `reload` alone is not enough.
    print("  rebooting to sync filesystem...")
    b.s.write(b"reboot\r\n")
    time.sleep(0.5)
    b.close()
    time.sleep(6)
    b2 = Badge(boot_wait=4.0)
    ok = True
    for name, blob in (("main.lua", main), ("manifest.cfg", man)):
        got = b2.size_of(f"{base}/{name}")
        state = "ok" if got == len(blob) else f"MISMATCH (got {got})"
        print(f"  {name:14s} {len(blob):6d}B  {state}")
        ok = ok and got == len(blob)
    print(b2.cmd("apps").strip().split("\n")[-1] if ok else "")
    b2.close()
    if not ok:
        raise SystemExit("upload verification failed")


def telemetry(b: Badge):
    """Real telemetry scraped from the badge console.

    Deliberately excludes everything in identity.json (name, email, phone,
    socials) and solana.json (keypair). Those are personal data and a private
    key; they are not for sale and never leave the device through VENDX.
    """
    import json, re
    out = {"source": "badge", "ok": True}

    heap = b.cmd("heap", timeout=10)
    for k in ("sys_free", "sys_largest", "sys_min", "lv_free", "lv_used_pct", "lv_frag_pct"):
        m = re.search(rf"{k}=(\d+)", heap)
        if m:
            out[k] = int(m.group(1))
    tasks = re.findall(r"task=(\S+)\s+prio=\s*(\d+)\s+stack_free=(\d+)", heap)
    out["tasks"] = [{"name": t, "prio": int(p), "stack_free": int(f)} for t, p, f in tasks]

    radio = b.cmd("radio probe", timeout=15)
    for k in ("controller_state", "running", "advertising", "scanning", "free_heap",
              "largest_heap_block", "dma_free"):
        m = re.search(rf"^{k}=(\d+)", radio, re.M)
        if m:
            out["radio_" + k] = int(m.group(1))
    m = re.search(r"Bluetooth MAC: ([0-9a-f:]{17})", radio)
    if m:
        # Hash the MAC rather than publishing it — it is a stable device
        # identifier and selling it would be a tracking vector.
        import hashlib
        out["device_hash"] = hashlib.sha256(m.group(1).encode()).hexdigest()[:16]

    snap = b.cmd("snapshot stats", timeout=20)
    for k in ("bytes", "seen", "text", "binary"):
        m = re.search(rf"{k}=(\d+)", snap)
        if m:
            out["fs_" + k] = int(m.group(1))

    journal = b.cmd("cat /littlefs/nfc_journal.txt", timeout=25)
    boots = [l for l in journal.split("\n") if " boot " in l]
    out["boot_count"] = len(boots)
    rr = {}
    for l in boots:
        m = re.search(r"rr=(\d+)", l)
        if m:
            rr[m.group(1)] = rr.get(m.group(1), 0) + 1
    out["reset_reasons"] = rr
    out["chip"] = "ESP32-C3"
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    op = sys.argv[1]
    b = Badge()
    try:
        if op == "cmd":
            for c in sys.argv[2:]:
                print(f"===== $ {c} =====")
                print(b.cmd(c))
        elif op == "push":
            push_app(b, sys.argv[2], sys.argv[3])
        elif op == "telemetry":
            import json
            print(json.dumps(telemetry(b), indent=2))
        elif op == "rm":
            slug = sys.argv[2]
            for f in ("main.lua", "manifest.cfg", "icon.bin"):
                b.cmd(f"rm /littlefs/apps/{slug}/{f}")
            print(b.cmd("reload", timeout=12.0))
        else:
            raise SystemExit(__doc__)
    finally:
        b.close()
