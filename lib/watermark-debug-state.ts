import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const STATE_FILE = join(tmpdir(), "watermark-debug-state.json");

let cachedState: boolean | null = null;

export async function isWatermarkDebugEnabled(): Promise<boolean> {
  if (process.env.WATERMARK_DEBUG === "1") {
    return true;
  }
  
  if (cachedState !== null) {
    return cachedState;
  }
  
  try {
    const data = await fs.readFile(STATE_FILE, "utf8");
    const json = JSON.parse(data);
    cachedState = Boolean(json.enabled);
    return cachedState;
  } catch {
    cachedState = false;
    return false;
  }
}

export async function setWatermarkDebugEnabled(enabled: boolean): Promise<void> {
  cachedState = enabled;
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify({ enabled }), "utf8");
  } catch (err) {
    console.error("写入水印调试状态文件失败:", err);
  }
}
