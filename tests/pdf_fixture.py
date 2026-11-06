from pathlib import Path


def make_pdf(path, empty=False, scanned_body=False, columns=False):
    first = (
        b""
        if empty
        else b"""BT /F1 24 Tf 36 354 Td (A Small Book) Tj ET
BT /F1 12 Tf 48 320 Td (The first paragraph has) Tj ET
BT /F2 12 Tf 36 304 Td (a quiet opening.) Tj ET
BT /F1 12 Tf 48 280 Td (\"Come back,\" she said.) Tj ET
BT /F1 12 Tf 48 64 Td (The story continues) Tj ET"""
    )
    second = (
        b""
        if empty
        else b"""BT /F1 12 Tf 36 354 Td (across pages.) Tj ET
BT /F1 12 Tf 48 320 Td (A final paragraph.) Tj ET"""
    )
    if scanned_body:
        first = b"q 240 0 0 320 30 40 cm /Scan Do Q\nBT /F1 12 Tf 130 20 Td (Page 1) Tj ET"
        second = b""
    if columns:
        first = b"BT /F1 12 Tf 24 354 Td (Left column.) Tj 156 0 Td (Right column.) Tj ET"
        second = b""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(first)).encode() + b" >>\nstream\n" + first + b"\nendstream",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>",
        b"<< /Length " + str(len(second)).encode() + b" >>\nstream\n" + second + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
        b"<< /Title (A Small Book) /Author (Example Author) >>",
    ]
    if scanned_body:
        objects[2] = objects[2].replace(
            b"/Resources <<", b"/Resources << /XObject << /Scan 10 0 R >>"
        )
        pixels = bytes([126, 24, 24, 24, 24, 24, 24, 126])
        objects.append(
            b"<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray "
            b"/BitsPerComponent 1 /Length 8 >>\nstream\n" + pixels + b"\nendstream"
        )
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010d} 00000 n \n".encode())
    data.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R /Info 9 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    Path(path).write_bytes(data)
