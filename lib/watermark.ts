import path from "node:path";
import sharp from "sharp";

// MCP transports images inside JSON as Base64 (about 33% larger than binary).
// Keep the binary payload at 3 MB so the request and response stay below
// Vercel's 4.5 MB body limit after JSON/Base64 overhead.
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_TEXT_LENGTH = 40;
const RESPONSE_LIMIT = 3 * 1024 * 1024;

const positions = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

type Position = typeof positions[number];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function escapeMarkup(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getCoordinates(
  position: Position,
  imageWidth: number,
  imageHeight: number,
  layerWidth: number,
  layerHeight: number,
  margin: number,
) {
  const horizontal = position.endsWith("left")
    ? "left"
    : position.endsWith("right")
      ? "right"
      : "center";
  const vertical = position.startsWith("top")
    ? "top"
    : position.startsWith("bottom")
      ? "bottom"
      : "center";

  const left = horizontal === "left"
    ? margin
    : horizontal === "right"
      ? imageWidth - layerWidth - margin
      : Math.round((imageWidth - layerWidth) / 2);
  const top = vertical === "top"
    ? margin
    : vertical === "bottom"
      ? imageHeight - layerHeight - margin
      : Math.round((imageHeight - layerHeight) / 2);

  return { left: Math.max(0, left), top: Math.max(0, top) };
}

async function renderText(text: string, fontSize: number, color: string, fontFile: string) {
  return sharp({
    text: {
      text: `<span foreground="${color}">${escapeMarkup(text)}</span>`,
      font: `Noto Sans SC ${fontSize}`,
      fontfile: fontFile,
      dpi: 72,
      rgba: true,
    },
  }).png().toBuffer({ resolveWithObject: true });
}

export async function addTextWatermark(input: {
  image_base64: string;
  text: string;
  position?: string;
  font_size?: number;
}) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image_base64) || input.image_base64.length % 4 !== 0) {
    throw new Error("image_base64 不是有效的 Base64 数据");
  }

  const source = Buffer.from(input.image_base64, "base64");
  if (source.length > MAX_FILE_SIZE) throw new Error("图片不能超过 3 MB");

  const text = input.text.trim();
  if (!text) throw new Error("水印文字不能为空");
  if (text.length > MAX_TEXT_LENGTH) throw new Error("水印文字不能超过 40 个字符");

  const position = (input.position ?? "bottom-right") as Position;
  if (!positions.includes(position)) throw new Error("水印位置无效");

  const normalized = await sharp(source, {
    failOn: "error",
    limitInputPixels: MAX_PIXELS,
  }).rotate().toBuffer({ resolveWithObject: true });

  if (!normalized.info.width || !normalized.info.height) throw new Error("无法读取图片尺寸");
  if (!["jpeg", "png", "webp"].includes(normalized.info.format)) {
    throw new Error("仅支持 JPG、PNG 和 WebP 图片");
  }

  const width = normalized.info.width;
  const height = normalized.info.height;
  const shortSide = Math.min(width, height);
  const requestedSize = input.font_size;
  let fontSize = Number.isFinite(requestedSize) && requestedSize! > 0
    ? Math.round(requestedSize!)
    : Math.round(shortSide / 5);
  fontSize = clamp(fontSize, 12, shortSide);

  const margin = Math.max(16, Math.round(shortSide * 0.035));
  const maxTextWidth = width - margin * 2;
  const fontFile = path.join(process.cwd(), "assets/fonts/NotoSansSC-Bold.ttf");

  let foreground = await renderText(text, fontSize, "#ffffffe6", fontFile);
  if (foreground.info.width > maxTextWidth) {
    fontSize = Math.max(12, Math.floor(fontSize * (maxTextWidth / foreground.info.width)));
    foreground = await renderText(text, fontSize, "#ffffffe6", fontFile);
  }
  const shadow = await renderText(text, fontSize, "#00000066", fontFile);
  const coordinates = getCoordinates(
    position,
    width,
    height,
    foreground.info.width,
    foreground.info.height,
    margin,
  );
  const shadowOffset = Math.max(2, Math.round(fontSize * 0.035));

  const pipeline = sharp(normalized.data).composite([
    {
      input: shadow.data,
      left: Math.max(0, Math.min(width - shadow.info.width, coordinates.left + shadowOffset)),
      top: Math.max(0, Math.min(height - shadow.info.height, coordinates.top + shadowOffset)),
    },
    { input: foreground.data, ...coordinates },
  ]);

  let output = await pipeline.clone().webp({ quality: 88, effort: 4 }).toBuffer();
  if (output.length > RESPONSE_LIMIT) {
    output = await pipeline.clone().webp({ quality: 68, effort: 4 }).toBuffer();
  }
  if (output.length > RESPONSE_LIMIT) {
    throw new Error("生成的图片过大，请先缩小原图后重试");
  }

  return {
    data: output.toString("base64"),
    mimeType: "image/webp",
    width,
    height,
    fontSize,
    renderer: "sharp-pango-v1",
    debug: process.env.WATERMARK_DEBUG === "1" ? `${process.platform}/${process.arch} · fontSize=${fontSize}` : undefined,
  };
}
