"""Build and publish only the static web application to Otimififi."""

import argparse
import base64
import gzip
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


class Publisher:
    def __init__(self, website):
        self.website = website
        self.base = os.environ["OTIMIFIFI_API_BASE"].rstrip("/")
        self.token = os.environ["OTIMIFIFI_ACCESS_TOKEN"]

    def curl(self, url, token, method="GET", data=None, file=None, headers=None):
        with tempfile.TemporaryDirectory(prefix="epub-publish-") as folder:
            args = [
                "curl",
                "--config",
                "-",
                "--silent",
                "--show-error",
                "--fail-with-body",
                "--max-time",
                "120",
                "--user-agent",
                "pdf-to-epub/0.1",
                "--request",
                method,
                url,
            ]
            config = "header = " + json.dumps("Authorization: " + token) + "\n"
            for key, value in (headers or {}).items():
                config += "header = " + json.dumps(key + ": " + value) + "\n"
            if data is not None:
                body = Path(folder) / "body.json"
                body.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                args += [
                    "--header",
                    "Content-Type: application/json",
                    "--data-binary",
                    "@" + str(body),
                ]
            elif file:
                args += ["--data-binary", "@" + str(file)]
            result = subprocess.run(args, input=config, text=True, capture_output=True, check=False)
            if result.returncode:
                try:
                    error = json.loads(result.stdout)
                    message = error.get("message", error.get("msg", "API request failed"))
                except json.JSONDecodeError:
                    message = "HTTP request failed"
                raise RuntimeError(f"{method} request failed: {message}")
            return json.loads(result.stdout)

    def api(self, path, method="GET", data=None):
        response = self.curl(self.base + "/api/v1" + path, "Bearer " + self.token, method, data)
        if response.get("status") != "success":
            raise RuntimeError(
                "Otimififi rejected the request: "
                + str(response.get("message", response.get("msg", "unknown error")))
            )
        return response["payload"]

    def asset(self, file, mime):
        file = Path(file)
        size = file.stat().st_size
        cache_path = ROOT / ".work/upload-cache.json"
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        key = (
            "scoped:"
            + self.website
            + ":"
            + mime
            + ":"
            + hashlib.sha256(file.read_bytes()).hexdigest()
        )
        if key in cache:
            return cache[key]
        name = file.stem + "-" + hashlib.sha256(file.read_bytes()).hexdigest()[:12] + file.suffix
        prepared = self.api(
            "/media/prepare",
            "POST",
            {"name": name, "type": mime, "size": size, "website_id": self.website},
        )
        if "uploadUrl" not in prepared:
            raise RuntimeError("Unexpected prepare fields: " + ", ".join(prepared.keys()))
        uploaded = self.curl(
            prepared["uploadUrl"],
            prepared["authorizationToken"],
            "POST",
            file=file,
            headers={
                "X-Bz-File-Name": quote(
                    prepared["userScope"]
                    + "/"
                    + prepared["pit"]
                    + "/"
                    + prepared["suggestedFileName"],
                    safe="/",
                ),
                "Content-Type": mime,
                "X-Bz-Content-Sha1": hashlib.sha1(file.read_bytes()).hexdigest(),
            },
        )
        confirmed = self.api(
            "/media/" + prepared["pit"],
            "POST",
            {
                "filename": uploaded["fileName"],
                "type": mime,
                "size": size,
                "original_url": prepared["publicUrl"],
            },
        )
        print("Uploaded " + file.name, flush=True)
        cache[key] = confirmed["public_url"]
        cache_path.parent.mkdir(exist_ok=True)
        cache_path.write_text(json.dumps(cache, indent=2), encoding="utf-8")
        return confirmed["public_url"]

    def publish(self):
        site = self.api("/websites/" + self.website)
        if site["locale_setup_required"]:
            self.api(
                "/websites/" + self.website + "/locales",
                "PUT",
                {"default_locale": "zh-Hans", "locales": ["zh-Hans"]},
            )
        if site.get("description"):
            raise RuntimeError(
                "The current pageserver fails with a nonempty site description. Use an empty description until the platform bug is fixed."
            )
        pages = self.api("/websites/" + self.website + "/pages")
        page = next(item for item in pages if item["pathname"] == "")
        print("Building static application", flush=True)
        env = {
            **os.environ,
            "VITE_SAMPLE_URL": "data:application/pdf;base64,"
            + base64.b64encode((ROOT / "web/public/sample.pdf").read_bytes()).decode(),
            "VITE_SAMPLE_IMAGE_URL": self.asset(ROOT / "web/public/sample.png", "image/png"),
        }
        subprocess.run(["npm", "run", "build"], cwd=ROOT / "web", env=env, check=True)
        assets = ROOT / "web/dist/assets"
        bundle = next(assets.glob("index-*.js")).read_bytes()
        compressed = base64.b64encode(gzip.compress(bundle, mtime=0)).decode("ascii")
        loader = f"""(async () => {{
  try {{
    const bytes = Uint8Array.from(atob('{compressed}'), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const script = document.createElement('script');
    script.textContent = await new Response(stream).text();
    document.body.append(script);
  }} catch (error) {{
    document.querySelector('.startup-status p').textContent = '应用加载失败，请刷新重试。';
    console.error('Application startup failed', error);
  }}
}})();"""
        css = [self.asset(file, "text/css") for file in sorted(assets.glob("index-*.css"))]
        self.api("/websites/" + self.website + "/layout", "PUT", {"layout_enabled": False})
        if site["site_tracking_enabled"] or site["site_comment_enabled"]:
            raise RuntimeError(
                "Disable site tracking and comments before publishing a browser workspace."
            )
        config = {
            "cssFileLinks": [{"href": url} for url in css],
            "jsFileLinks": [],
            "inlineScripts": [{"code": loader, "position": "body_end"}],
            "inlineStyles": [
                ".startup-status{font:15px/1.7 system-ui;max-width:42rem;margin:10vh auto;padding:24px;color:#303638}.startup-status h1{font-size:28px}.startup-status a{color:#286b53;margin-right:24px}"
            ],
        }
        path = "/pages/" + page["id"]
        self.api(
            path + "/drafts/0",
            "PUT",
            {
                "title": "PDF to EPUB · 制作工作台",
                "source_code": '<div id="root"><main class="startup-status"><h1>PDF to EPUB</h1><p>正在加载制作工作台...</p><noscript>请启用 JavaScript。</noscript><a href="https://github.com/qar/pdf-to-epub">项目与运行说明</a></main></div>',
                "config": config,
            },
        )
        release = self.api(path + "/drafts/0/commit", "POST", {})
        version = release["version"]
        self.api(path + "/change-version", "PUT", {"version": version})
        report = {
            "website_id": self.website,
            "page_id": page["id"],
            "version": version,
            "site_url": site["preview"],
            "full_url": page["full_url"],
            "assets": {
                "js": "inline gzip bundle",
                "sha256": hashlib.sha256(bundle).hexdigest(),
                "css": css,
                "runtime": "in-page PDF.js and EPUBCheck",
                "sample": "bundled original sample",
                "sample_image": env["VITE_SAMPLE_IMAGE_URL"],
            },
        }
        output = ROOT / ".work/deployment.json"
        output.parent.mkdir(exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--website", required=True)
    args = parser.parse_args()
    Publisher(args.website).publish()
