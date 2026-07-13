import sharp from "sharp";
import { join } from "node:path";

const positions = ["northwest", "northeast", "center", "southwest", "southeast"] as const;
type Position = typeof positions[number];
const fontFile = join(process.cwd(), "public/fonts/NotoSansSC-CN.ttf");

export async function addTextWatermark(input: {
  image_base64: string;
  text: string;
  position?: string;
  opacity?: number;
  font_size?: number;
}) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image_base64) || input.image_base64.length % 4 !== 0) throw new Error("image_base64 不是有效的 Base64 数据");
  const source = Buffer.from(input.image_base64, "base64");
  if (source.length > 3 * 1024 * 1024) throw new Error("图片不能超过 3 MB");
  if (!input.text || input.text.length > 200) throw new Error("text 不能为空且不能超过 200 个字符");
  const position = (input.position || "southeast") as Position;
  if (!positions.includes(position)) throw new Error("position 不合法");
  const opacity = input.opacity ?? 0.35;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error("opacity 必须在 0 到 1 之间");

  const image = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format || "")) throw new Error("仅支持 JPEG、PNG 和 WebP 图片");
  const shortEdge = Math.min(metadata.width, metadata.height);
  const fontSize = input.font_size ?? Math.min(160, Math.max(16, Math.round(shortEdge * 0.075)));
  if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 500) throw new Error("font_size 必须是 8 到 500 的整数");
  const padding = Math.max(fontSize * 1.6, shortEdge * 0.05);
  const watermark = await sharp({ text: { text: `<span foreground="white" alpha="${Math.round(opacity * 100)}%">${escapeMarkup(input.text)}</span>`, font: `Noto Sans SC ${fontSize}`, fontfile: fontFile, rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
  const left = Math.max(0, Math.round(position.endsWith("west") ? padding : position.endsWith("east") ? metadata.width - padding - watermark.info.width : (metadata.width - watermark.info.width) / 2));
  const top = Math.max(0, Math.round(position.startsWith("north") ? padding : position.startsWith("south") ? metadata.height - padding - watermark.info.height : (metadata.height - watermark.info.height) / 2));
  const { data, info } = await image.composite([{ input: watermark.data, left, top }]).toBuffer({ resolveWithObject: true });
  if (data.length > 3 * 1024 * 1024) throw new Error("处理后的图片超过 3 MB，请先压缩原图");
  return { data: data.toString("base64"), mimeType: `image/${info.format}`, width: info.width, height: info.height, renderer: "sharp-fontfile-v1" };
}

function escapeMarkup(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" })[character]!);
}
