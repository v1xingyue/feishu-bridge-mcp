import { configStatus } from "@/lib/feishu";

export function GET() {
  return Response.json(configStatus());
}
