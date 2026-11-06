import hmac
import html
import json
import mimetypes
import re
import secrets
import subprocess
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit

from .common import ConversionError
from .validate import doctor
from .workspace import Workspace

MAX_BODY = 45 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def origin_of(value):
    url = urlsplit(value)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password:
        raise ValueError("Expected an HTTP or HTTPS origin.")
    return f"{url.scheme}://{url.netloc}"


class Handler(BaseHTTPRequestHandler):
    server_version = "PDFToEPUB/0.1"

    def log_message(self, *_args):
        pass

    def respond(self, status, body=b"", content_type="application/json", **headers):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for name, value in headers.items():
            self.send_header(name.replace("_", "-"), value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 0 or size > MAX_BODY:
            raise ApiError(413, "file_too_large", "PDF must be smaller than 32 MiB.")
        if self.headers.get_content_type() != "application/json":
            raise ApiError(415, "content_type", "Use application/json.")
        value = json.loads(self.rfile.read(size))
        if not isinstance(value, dict):
            raise TypeError("Expected a JSON object.")
        return value

    def dispatch(self):
        port = self.server.server_port
        local_origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}"}
        if self.headers.get("Host") not in {urlsplit(o).netloc for o in local_origins}:
            raise ApiError(403, "host_denied", "Invalid local host.")
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.origins:
            raise ApiError(
                403, "origin_denied", "This website is not paired with the local service."
            )
        path = unquote(urlsplit(self.path).path)
        if self.command == "OPTIONS":
            self.respond(
                204,
                Access_Control_Allow_Methods="GET, POST, PUT, DELETE, OPTIONS",
                Access_Control_Allow_Headers="Authorization, Content-Type",
                Access_Control_Allow_Private_Network="true",
            )
            return
        if self.command == "GET" and path == "/api/health":
            self.respond(200, {"service": "pdf-to-epub", "version": 1, **doctor(self.server.jar)})
            return
        if self.command == "GET" and path == "/api/session":
            if origin not in local_origins and self.headers.get("Sec-Fetch-Site") != "same-origin":
                raise ApiError(403, "local_only", "Open the local editor to pair this browser.")
            if self.headers.get("Sec-Fetch-Site") not in {None, "same-origin"}:
                raise ApiError(403, "local_only", "Open the local editor to pair this browser.")
            self.respond(200, {"token": self.server.token})
            return
        if self.command == "GET" and path == "/connect":
            target = parse_qs(urlsplit(self.path).query).get("returnTo", [""])[0]
            if not target or origin_of(target) not in self.server.origins - local_origins:
                raise ApiError(403, "origin_denied", "The requested website is not configured.")
            target = (
                target.split("#", 1)[0]
                + "#"
                + urlencode({"token": self.server.token, "engine": f"http://127.0.0.1:{port}"})
            )
            document = f'''<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PDF to EPUB</title><style>body{{font:16px/1.7 system-ui;max-width:32em;margin:12vh auto;padding:24px;color:#222}}h1{{font-size:26px}}a{{display:inline-block;background:#216653;color:white;padding:10px 22px;border-radius:4px;text-decoration:none}}p{{overflow-wrap:anywhere;color:#555}}</style><h1>PDF to EPUB</h1><p>{html.escape(origin_of(target))}</p><a href="{html.escape(target, quote=True)}" rel="noreferrer">连接本机编辑器</a></html>'''
            self.respond(
                200,
                document.encode(),
                "text/html; charset=utf-8",
                Content_Security_Policy="default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
            )
            return
        if path.startswith("/api/"):
            provided = self.headers.get("Authorization", "")
            if not hmac.compare_digest(provided, "Bearer " + self.server.token):
                raise ApiError(401, "unauthorized", "Connect to the local service first.")
            self.api(path)
            return
        if self.command != "GET" or self.server.web_dir is None:
            raise ApiError(404, "not_found", "Resource not found.")
        root = self.server.web_dir.resolve()
        resource = (root / (path.lstrip("/") or "index.html")).resolve()
        if not resource.is_relative_to(root) or not resource.is_file():
            raise ApiError(404, "not_found", "Resource not found.")
        self.respond(
            200,
            resource.read_bytes(),
            mimetypes.guess_type(resource.name)[0] or "application/octet-stream",
        )

    def api(self, path):
        store = self.server.workspace
        with store.lock:
            if path == "/api/projects":
                if self.command == "GET":
                    self.respond(200, {"projects": store.list_projects()})
                    return
                if self.command == "POST":
                    self.respond(201, store.import_pdf(self.body()))
                    return
            match = re.fullmatch(
                r"/api/projects/([a-f0-9]{32})(?:/(preview|review|export|download|pdf))?", path
            )
            if not match:
                raise ApiError(404, "not_found", "Resource not found.")
            project_id, action = match.groups()
            if action is None and self.command == "GET":
                self.respond(200, store.detail(project_id))
            elif action is None and self.command == "PUT":
                self.respond(200, store.save(project_id, self.body()))
            elif action in {"preview", "review", "export"} and self.command == "POST":
                self.respond(200, getattr(store, action)(project_id, self.body()))
            elif action == "download" and self.command == "GET":
                export_id = parse_qs(urlsplit(self.path).query).get("export", [None])[0]
                content, filename = store.download(project_id, export_id)
                self.respond(
                    200,
                    content,
                    "application/epub+zip",
                    Content_Disposition="attachment; filename*=UTF-8''" + quote(filename),
                )
            elif action == "pdf" and self.command == "GET":
                self.respond(
                    200, (store.folder(project_id) / "source.pdf").read_bytes(), "application/pdf"
                )
            else:
                raise ApiError(405, "method_not_allowed", "Method not allowed.")

    def handle_request(self):
        try:
            self.dispatch()
        except ApiError as error:
            self.respond(error.status, {"code": error.code, "message": str(error)})
        except ConversionError as error:
            self.respond(
                {"conflict": 409, "not_found": 404}.get(error.code, 422),
                {"code": error.code, "message": str(error), **error.details},
            )
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            self.respond(400, {"code": "invalid_input", "message": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except subprocess.TimeoutExpired:
            self.respond(
                504, {"code": "timeout", "message": "The local conversion tool timed out."}
            )
        except ET.ParseError:
            self.respond(
                422, {"code": "invalid_pdf", "message": "The PDF text layout could not be read."}
            )
        except OSError:
            self.respond(
                500,
                {
                    "code": "storage_error",
                    "message": "The local workspace could not be read or written.",
                },
            )

    do_GET = do_POST = do_PUT = do_DELETE = do_OPTIONS = handle_request


def make_server(
    data_dir, port=48291, token=None, allowed_origins=(), epubcheck_jar=None, web_dir=None
):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.token = token or secrets.token_urlsafe(32)
    server.jar = epubcheck_jar
    server.data_dir = Path(data_dir)
    server.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    server.workspace = Workspace(server.data_dir, epubcheck_jar)
    server.web_dir = Path(web_dir) if web_dir else None
    server.origins = {origin_of(value) for value in allowed_origins} | {
        f"http://127.0.0.1:{server.server_port}",
        f"http://localhost:{server.server_port}",
    }
    return server
