import { NextRequest, NextResponse } from "next/server";

import { applyPatches } from "@/lib/story/patch";
import { parseStoryProject, validateProject } from "@/lib/story/schema";
import type { StoryPatch } from "@/lib/story/types";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { project?: unknown; operations?: StoryPatch[] };
    if (!body.project || !Array.isArray(body.operations)) {
      return NextResponse.json({ ok: false, error: "请求必须包含 project 与 operations[]" }, { status: 400 });
    }
    const source = parseStoryProject(body.project);
    const result = applyPatches(source, body.operations);
    const project = parseStoryProject(result.project);
    return NextResponse.json({
      ok: true,
      project,
      inverse: result.inverse,
      diagnostics: validateProject(project),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Patch 应用失败",
    }, { status: 422 });
  }
}
