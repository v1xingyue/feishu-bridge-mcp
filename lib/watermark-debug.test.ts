import "./setup-test-env.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/watermark-debug/route.ts";
import { isWatermarkDebugEnabled, setWatermarkDebugEnabled } from "./watermark-debug-state.ts";

test("Watermark debug route GET returns 403 by default (disabled)", async () => {
  // Ensure it starts as disabled
  await setWatermarkDebugEnabled(false);
  
  const response = await GET(new Request("http://localhost/api/watermark-debug"));
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.match(data.error, /已关闭/);
});

test("Watermark debug route GET returns status correctly", async () => {
  await setWatermarkDebugEnabled(false);
  const res1 = await GET(new Request("http://localhost/api/watermark-debug?status=true"));
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.enabled, false);

  process.env.WATERMARK_ENABLED = "1";
  await setWatermarkDebugEnabled(true);
  const res2 = await GET(new Request("http://localhost/api/watermark-debug?status=true"));
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.enabled, true);
  
  // Clean up
  await setWatermarkDebugEnabled(false);
  delete process.env.WATERMARK_ENABLED;
});

test("Watermark debug route POST checks session authentication", async (t) => {
  // getServerSession requires Next.js request context, which throws in raw Node.js test environment
  t.skip("Skipped: Requires Next.js server context");
});
