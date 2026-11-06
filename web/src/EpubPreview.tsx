import { useEffect, useRef } from "react";

const loadedFonts = new Map<string, Promise<FontFace>>();

export default function EpubPreview({
  html,
  width,
}: {
  html: string;
  width: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const root =
      host.current.shadowRoot || host.current.attachShadow({ mode: "open" });
    const document = new DOMParser().parseFromString(html, "text/html");
    const css = new CSSStyleSheet();
    css.replaceSync(document.querySelector("style")?.textContent || "");
    for (let index = css.cssRules.length - 1; index >= 0; index--) {
      const rule = css.cssRules[index];
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const encoded = rule.style
        .getPropertyValue("src")
        .match(/base64,([^)'"\s]+)/)?.[1];
      const family = rule.style
        .getPropertyValue("font-family")
        .replace(/["']/g, "");
      if (encoded) {
        const key = rule.cssText;
        if (!loadedFonts.has(key)) {
          const bytes = Uint8Array.from(atob(encoded), (char) =>
            char.charCodeAt(0),
          );
          const face = new FontFace(family, bytes, {
            style: rule.style.getPropertyValue("font-style") || "normal",
            weight: rule.style.getPropertyValue("font-weight") || "normal",
          });
          loadedFonts.set(
            key,
            face.load().then((font) => {
              window.document.fonts.add(font);
              return font;
            }),
          );
          void loadedFonts.get(key)!.catch(() => loadedFonts.delete(key));
        }
      }
      css.deleteRule(index);
    }
    root.adoptedStyleSheets = [css];
    // HTML comes only from our XML EPUB builder, which escapes source text.
    root.replaceChildren(document.body);
  }, [html]);
  return (
    <div
      ref={host}
      className="epub-preview"
      role="region"
      aria-label="EPUB 排版预览"
      style={{ width: `min(100%, ${width}px)` }}
    />
  );
}
