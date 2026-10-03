#!/usr/bin/env python3
"""
Check the QR encoder in src/commerce/qr.js against outside implementations.

Two independent checks, because a QR encoder that is subtly wrong still produces
something that looks like a QR code:

  1. Module-for-module equality with Python's `qrcode` package, for every mask.
     Mask selection is a quality heuristic rather than a correctness question, so
     the mask is pinned and everything else compared exactly.
  2. A real decode. The matrix is rendered to a bitmap and read back with
     OpenCV's detector, which has to recover the original string.

    pip install qrcode opencv-python-headless
    python3 tools/qr-verify.py
"""
import json
import subprocess
import sys

PAYLOADS = [
    "http://localhost:4173/validate-card?c=SBTK9S&k=J09Z39",
    "https://guide.lunart.it/validate-card?c=ABC123&k=XYZ789",
    "https://lunart.example/validate-card?c=ZZZZZZ&k=000000&extra=padding-to-push-the-version-up",
    "LUNART PRIVILEGE CARD — 2 persone",
    "x" * 100,
]

ENCODE = """
import { encodeQR } from '%s/src/commerce/qr.js';
const mask = process.argv[2] === 'auto' ? null : Number(process.argv[2]);
const m = encodeQR(process.argv[1], { forceMask: mask });
console.log(JSON.stringify({ size: m.size, cells: m.cells, version: m.version, mask: m.mask }));
"""


def encode(root, text, mask="auto"):
    out = subprocess.run(
        ["node", "--input-type=module", "-e", ENCODE % root, "--", text, str(mask)],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def check_against_reference(root):
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M

    checked = failed = 0
    for text in PAYLOADS:
        for mask in range(8):
            mine = encode(root, text, mask)
            ref = qrcode.QRCode(error_correction=ERROR_CORRECT_M, border=0, mask_pattern=mask)
            ref.add_data(text, optimize=0)   # byte mode, as ours always is
            ref.make(fit=True)
            matrix = [[1 if cell else 0 for cell in row] for row in ref.get_matrix()]
            checked += 1
            if matrix != mine["cells"]:
                failed += 1
                print(f"  MISMATCH  v{mine['version']} mask {mask}  {text[:44]}")
        print(f"  v{mine['version']:>2} {mine['size']}x{mine['size']}  8 masks identical   {text[:44]}")
    print(f"\n  {checked - failed}/{checked} matrices identical to python-qrcode")
    return failed == 0


def check_decodes(root):
    import cv2
    import numpy as np

    detector = cv2.QRCodeDetector()
    ok = True
    for text in PAYLOADS:
        m = encode(root, text)
        scale, margin, n = 12, 4, m["size"]
        img = np.full(((n + margin * 2) * scale,) * 2, 255, dtype=np.uint8)
        for r in range(n):
            for c in range(n):
                if m["cells"][r][c]:
                    y, x = (r + margin) * scale, (c + margin) * scale
                    img[y:y + scale, x:x + scale] = 0
        decoded, _, _ = detector.detectAndDecode(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
        good = decoded == text
        ok = ok and good
        print(f"  {'decoded' if good else 'FAILED '}  v{m['version']} mask {m['mask']}  {text[:44]}")
    return ok


if __name__ == "__main__":
    root = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                          capture_output=True, text=True, check=True).stdout.strip()
    print("Comparing with python-qrcode, every mask:")
    matched = check_against_reference(root)
    print("\nDecoding the rendered symbols with OpenCV:")
    decoded = check_decodes(root)
    print("\n" + ("QR encoder verified." if matched and decoded else "QR ENCODER FAILED VERIFICATION."))
    sys.exit(0 if matched and decoded else 1)
