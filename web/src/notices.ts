import sources from "../licenses/SOURCES.md?raw";

const texts = import.meta.glob(
  [
    "../licenses/*.txt",
    "../node_modules/{react,react-dom,scheduler,lucide-react,pdfjs-dist,epubcheck-standalone,fflate,idb,zod}/LICENSE",
    "../node_modules/epubcheck-standalone/THIRD-PARTY-NOTICES.txt",
    "../node_modules/@xmldom/xmldom/LICENSE",
    "../../skills/pdf-to-epub/scripts/pdf_epub/assets/fonts/OFL.txt",
  ],
  { eager: true, query: "?raw", import: "default" },
);

export const notices = [
  sources,
  ...Object.entries(texts).map(([name, content]) => `${name}\n\n${content}`),
].join("\n\n==================================================\n\n");
