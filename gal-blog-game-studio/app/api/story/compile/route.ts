import { NextRequest, NextResponse } from "next/server";

import { compileProject, compileScene } from "@/lib/story/compiler";
import { parseStoryProject } from "@/lib/story/schema";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { project?: unknown; sceneId?: string };
    if (!body.project) return NextResponse.json({ ok: false, error: "缺少 StoryProject" }, { status: 400 });
    const project = parseStoryProject(body.project);
    if (body.sceneId) {
      const scene = project.scenes.find((item) => item.id === body.sceneId);
      if (!scene) return NextResponse.json({ ok: false, error: `场景不存在：${body.sceneId}` }, { status: 404 });
      return NextResponse.json({ ok: true, sceneId: scene.id, ...compileScene(project, scene) });
    }
    return NextResponse.json({ ok: true, ...compileProject(project) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "编译失败",
    }, { status: 422 });
  }
}
