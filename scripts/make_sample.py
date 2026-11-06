"""Generate the original, public-domain sample used by the web workspace."""

import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = [
    (
        "The Art of Noticing",
        [
            "Field notes on ordinary days",
            "A quiet morning begins with an open window. Light travels across the desk and settles on the edge of a notebook. Nothing remarkable has happened, yet the room already holds a story.",
            "We often read a place too quickly. A street becomes a route; a table becomes a surface. When we pause, familiar things recover their details. The worn brass handle, the folded letter, the pale mark left by a cup: each asks for a little attention.",
            "These notes began as a small practice. Each day, I chose one ordinary thing and described it without trying to make it important. The practice changed what I saw.",
        ],
    ),
    (
        "A Measure of Light",
        [
            "The same room is never quite the same room. At noon, its corners retreat. In late afternoon, the window draws a long rectangle on the floor. The furniture has not moved, but the proportions feel different.",
            "I placed a sheet of white paper on the table and watched it for an hour. First it was bright, then silver, then almost blue. The paper did not explain the change. It simply received the light.",
            "Attention works in a similar way. It gives an experience enough space to become visible. It does not need to improve the experience or turn it into a lesson.",
            "At the end of the hour, I wrote one sentence: the ordinary is not a fixed condition. It is a relationship between the world and the time we give it.",
        ],
    ),
    (
        "Leaving a Margin",
        [
            "A page needs a margin. Without it, words press against the edge and the eye has nowhere to rest. The empty space is part of the composition, even though it carries no sentence.",
            "A day can have margins too. A short walk before work. A few minutes between one conversation and the next. An evening without a list. These intervals make room for what cannot be scheduled.",
            "I keep the last page of each notebook empty. It is not a rule about finishing. It is a reminder that a collection of observations is always incomplete. There is more to notice tomorrow.",
            "For now, the window is open. The desk is clear. There is enough light to begin again.",
        ],
    ),
]


def literal(text):
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def main():
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
    ]
    page_ids = []
    for title, paragraphs in PAGES:
        page_id = len(objects) + 1
        page_ids.append(page_id)
        commands = [f"BT /F1 25 Tf 45 506 Td ({literal(title)}) Tj ET", "0.3 w 45 484 m 90 484 l S"]
        y = 451
        for paragraph in paragraphs:
            for line in textwrap.wrap(paragraph, width=61):
                commands.append(f"BT /F1 12 Tf 45 {y} Td ({literal(line)}) Tj ET")
                y -= 18
            y -= 12
        stream = "\n".join(commands).encode("ascii")
        objects.extend(
            [
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>".encode(),
                b"<< /Length "
                + str(len(stream)).encode()
                + b" >>\nstream\n"
                + stream
                + b"\nendstream",
            ]
        )
    objects[1] = (
        "<< /Type /Pages /Kids ["
        + " ".join(f"{i} 0 R" for i in page_ids)
        + f"] /Count {len(page_ids)} >>"
    ).encode()
    objects.append(b"<< /Title (The Art of Noticing) /Author (PDF to EPUB Studio) >>")
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
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R /Info {len(objects)} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    public = ROOT / "web/public"
    public.mkdir(exist_ok=True)
    target = public / "sample.pdf"
    target.write_bytes(data)
    subprocess.run(
        [
            "pdftoppm",
            "-f",
            "1",
            "-singlefile",
            "-scale-to",
            "720",
            "-png",
            str(target),
            str(public / "sample"),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
