#!/usr/bin/env python3
"""
Console for an ESP32 running firmware-vendor/ (NOT the HTN factory badge — for
that use scripts/badge.py).

  vendor_console.py tail  [--log FILE]           own the port: follow output, log it, relay commands
  vendor_console.py send  "<cmd>" [--wait SEC]   hand a command to the running tail, print the reply
  vendor_console.py wifi  <ssid> [pass]          shorthand for: send 'wifi "<ssid>" <pass>'

ONE process must own the serial port. On the C3's USB-Serial/JTAG a second
open() toggles DTR/RTS and resets the chip into download mode (observed:
`rst:0x15 boot:0x5 DOWNLOAD`). So `send` never opens the port — it writes to a
FIFO that the `tail` process forwards, and reads the reply from the tail's log.

Port: $VENDX_VENDOR_PORT, default /dev/cu.usbmodem101.
State: ~/.vendx/vendor-serial.log (default log), ~/.vendx/vendor-serial.cmd (FIFO).
"""
import argparse, errno, os, stat, sys, time
import serial

PORT = os.environ.get("VENDX_VENDOR_PORT", "/dev/cu.usbmodem101")
BAUD = 115200
STATE = os.path.expanduser("~/.vendx")
DEFAULT_LOG = os.path.join(STATE, "vendor-serial.log")
FIFO = os.path.join(STATE, "vendor-serial.cmd")


def open_port(port):
    while True:
        try:
            s = serial.Serial(port, BAUD, timeout=0.1)
            # Same order badge.py uses; never drive either line high afterwards.
            s.setDTR(False)
            s.setRTS(False)
            return s
        except (serial.SerialException, OSError):
            time.sleep(0.5)


def ensure_fifo():
    os.makedirs(STATE, exist_ok=True)
    try:
        if not stat.S_ISFIFO(os.stat(FIFO).st_mode):
            os.remove(FIFO)
            os.mkfifo(FIFO)
    except FileNotFoundError:
        os.mkfifo(FIFO)
    return os.open(FIFO, os.O_RDONLY | os.O_NONBLOCK)


def tail(port, log):
    out = open(log, "a", buffering=1)

    def emit(text):
        stamp = time.strftime("%H:%M:%S")
        for line in text.splitlines():
            row = f"{stamp} {line}"
            print(row, flush=True)
            out.write(row + "\n")

    fifo = ensure_fifo()
    pending = b""
    emit(f"[console] waiting for {port}; commands via {FIFO}")
    while True:
        s = open_port(port)
        emit("[console] opened " + port)
        buf = b""
        try:
            while True:
                chunk = s.read(4096)
                if chunk:
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        emit(line.decode("utf8", "replace").rstrip("\r"))
                try:
                    cmd = os.read(fifo, 4096)
                except BlockingIOError:
                    cmd = b""
                except OSError as e:
                    if e.errno != errno.EAGAIN:
                        raise
                    cmd = b""
                if cmd:
                    pending += cmd
                    while b"\n" in pending:
                        line, pending = pending.split(b"\n", 1)
                        if line.strip():
                            emit("[console] > " + line.decode("utf8", "replace"))
                            s.write(line.strip() + b"\n")
                            s.flush()
        except (serial.SerialException, OSError) as e:
            emit(f"[console] port lost ({e.__class__.__name__}); reconnecting")
            try:
                s.close()
            except Exception:
                pass
            time.sleep(1.0)


def send(cmd, wait, log):
    try:
        fd = os.open(FIFO, os.O_WRONLY | os.O_NONBLOCK)
    except OSError as e:
        sys.exit(f"no running `vendor_console.py tail` to forward to ({e.strerror}); start it first")
    mark = os.path.getsize(log) if os.path.exists(log) else 0
    os.write(fd, cmd.encode() + b"\n")
    os.close(fd)
    time.sleep(wait)
    with open(log, "rb") as f:
        f.seek(mark)
        print(f.read().decode("utf8", "replace").rstrip())


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("tail"); t.add_argument("--log", default=DEFAULT_LOG)
    sd = sub.add_parser("send"); sd.add_argument("text"); sd.add_argument("--wait", type=float, default=2.0)
    sd.add_argument("--log", default=DEFAULT_LOG)
    w = sub.add_parser("wifi"); w.add_argument("ssid"); w.add_argument("password", nargs="?", default="")
    w.add_argument("--log", default=DEFAULT_LOG)
    a = ap.parse_args()
    if a.cmd == "tail":
        tail(PORT, a.log)
    elif a.cmd == "send":
        send(a.text, a.wait, a.log)
    elif a.cmd == "wifi":
        send(f'wifi "{a.ssid}" {a.password}'.rstrip(), 15.0, a.log)


if __name__ == "__main__":
    main()
