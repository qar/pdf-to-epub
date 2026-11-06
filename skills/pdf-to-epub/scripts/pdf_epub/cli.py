import argparse
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from .build import build_epub
from .common import ConversionError
from .extract import extract_pdf
from .validate import doctor, validate_epub


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Produce reflowable text EPUBs from reviewed PDF text."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("doctor", help="Report local conversion and validation tools.")
    check.add_argument("--epubcheck-jar")
    validate = commands.add_parser("validate", help="Check the package and run EPUBCheck.")
    validate.add_argument("epub")
    validate.add_argument("--epubcheck-jar")
    validate.add_argument(
        "--internal-only",
        action="store_true",
        help="Run limited internal checks without claiming EPUB conformance.",
    )
    extract = commands.add_parser("extract", help="Extract text evidence and a draft book plan.")
    extract.add_argument("pdf")
    extract.add_argument("--work-dir", required=True)
    extract.add_argument("--language", default="und")
    extract.add_argument(
        "--password-file",
        help="A file containing the opening password; never passed directly on the command line.",
    )
    build = commands.add_parser("build", help="Build an EPUB from a reviewed book.json.")
    build.add_argument("plan")
    build.add_argument("--output", required=True)
    build.add_argument(
        "--allow-draft", action="store_true", help="Produce a preview, not a reviewed deliverable."
    )
    serve = commands.add_parser("serve", help="Start the local browser workspace.")
    serve.add_argument("--port", type=int, default=48291)
    serve.add_argument("--data-dir", default=str(Path.home() / ".local/share/pdf-to-epub"))
    serve.add_argument("--allowed-origin", action="append", default=[])
    serve.add_argument("--web-dir", default=str(Path(__file__).resolve().parents[4] / "web/dist"))
    serve.add_argument("--epubcheck-jar")
    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            from .server import make_server

            server = make_server(
                args.data_dir,
                args.port,
                allowed_origins=args.allowed_origin,
                epubcheck_jar=args.epubcheck_jar,
                web_dir=args.web_dir,
            )
            print(
                json.dumps(
                    {
                        "status": "listening",
                        "url": f"http://127.0.0.1:{server.server_port}",
                        "allowed_origins": sorted(server.origins),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
            return 0
        if args.command == "doctor":
            result = doctor(args.epubcheck_jar)
        elif args.command == "validate":
            result = validate_epub(args.epub, args.epubcheck_jar, args.internal_only)
        elif args.command == "extract":
            result = extract_pdf(args.pdf, args.work_dir, args.language, args.password_file)
        else:
            result = build_epub(args.plan, args.output, args.allow_draft)
    except ConversionError as error:
        result = {"status": "error", "code": error.code, "message": str(error), **error.details}
        print(json.dumps(result, ensure_ascii=False))
        return 1
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        ET.ParseError,
        subprocess.TimeoutExpired,
    ) as error:
        print(
            json.dumps(
                {"status": "error", "code": "invalid_input", "message": str(error)},
                ensure_ascii=False,
            )
        )
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result["status"] == "unchecked" else 1 if result["status"] == "invalid" else 0


if __name__ == "__main__":
    sys.exit(main())
