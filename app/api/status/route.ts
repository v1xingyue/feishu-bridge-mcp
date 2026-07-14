import { configStatus } from "@/lib/feishu";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as fontkit from "fontkit";

export async function GET() {
  const status = configStatus();
  
  const diagnostics: Record<string, any> = {
    status,
    cwd: process.cwd(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  };
  
  const fontPath = join(process.cwd(), "public/fonts/NotoSansSC-CN.ttf");
  diagnostics.fontPath = fontPath;
  
  const esmFontPath = new URL("../../../public/fonts/NotoSansSC-CN.ttf", import.meta.url).pathname;
  diagnostics.esmFontPath = esmFontPath;
  
  try {
    const data = await readFile(new URL("../../../public/fonts/NotoSansSC-CN.ttf", import.meta.url));
    diagnostics.fontFileExists = true;
    diagnostics.fontFileSize = data.length;
    
    try {
      const font = fontkit.create(data) as fontkit.Font;
      diagnostics.fontkitLoaded = true;
      diagnostics.postscriptName = font.postscriptName;
      diagnostics.fullName = font.fullName;
      diagnostics.numGlyphs = font.numGlyphs;
      
      const testText = "中文水印 Test";
      const run = font.layout(testText);
      diagnostics.layoutText = testText;
      diagnostics.layoutGlyphs = run.glyphs.map((glyph, index) => ({
        id: glyph.id,
        codePoints: glyph.codePoints,
        name: glyph.name,
        hasPath: glyph.path.toSVG().length > 0,
        pathLength: glyph.path.toSVG().length,
      }));
    } catch (fontkitError) {
      diagnostics.fontkitLoaded = false;
      diagnostics.fontkitError = fontkitError instanceof Error ? fontkitError.message : String(fontkitError);
    }
  } catch (fileError) {
    diagnostics.fontFileExists = false;
    diagnostics.fileError = fileError instanceof Error ? fileError.message : String(fileError);
  }
  
  return Response.json(diagnostics);
}
