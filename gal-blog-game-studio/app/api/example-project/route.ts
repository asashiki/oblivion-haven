import { NextResponse } from "next/server";

import { exampleProject } from "@/lib/story/example";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(exampleProject);
}
