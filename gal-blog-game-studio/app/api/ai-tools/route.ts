import { NextRequest, NextResponse } from "next/server";

import { executeAiTool, type AiToolCall } from "@/lib/story/aiTools";
import { AI_TOOL_CATALOG } from "@/lib/story/patch";
import { parseStoryProject } from "@/lib/story/schema";

export const runtime = "edge";

export async function GET() {
  return NextResponse.json({
    version: 1,
    protocol: "story-patch",
    sourceOfTruth: "StoryProject",
    tools: AI_TOOL_CATALOG,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { project?: unknown; call?: AiToolCall };
    if (!body.project || !body.call) {
      return NextResponse.json({ ok: false, error: "请求必须包含 project 与 call" }, { status: 400 });
    }
    const project = parseStoryProject(body.project);
    return NextResponse.json(executeAiTool(project, body.call));
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "AI 工具执行失败",
    }, { status: 422 });
  }
}
