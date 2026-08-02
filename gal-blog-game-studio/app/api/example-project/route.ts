import { NextResponse } from "next/server";

import { generatedAcceptanceProject } from "@/lib/story/generatedAcceptance";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json(generatedAcceptanceProject);
}
