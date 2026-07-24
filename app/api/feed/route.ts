import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export function GET() {
  const filePath = join(process.cwd(), "data", "resets.json");
  const data = readFileSync(filePath, "utf-8");
  return new NextResponse(data, {
    headers: { "Content-Type": "application/json" },
  });
}
