import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

function providerConfig() {
  return {
    endpoint: process.env.TTS_PROVIDER_ENDPOINT?.trim(),
    apiKey: process.env.TTS_PROVIDER_API_KEY?.trim(),
    defaultModel: process.env.TTS_PROVIDER_MODEL?.trim() || "tts-1",
    defaultVoice: process.env.TTS_PROVIDER_VOICE?.trim() || "alloy",
  };
}

export async function GET() {
  const config = providerConfig();
  return NextResponse.json({
    configured: Boolean(config.endpoint),
    protocol: "openai-compatible-audio-speech",
    credentials: config.apiKey ? "server-side" : "none",
  });
}

export async function POST(request: NextRequest) {
  const config = providerConfig();
  if (!config.endpoint) {
    return NextResponse.json({
      ok: false,
      error: "TTS Provider 尚未配置。部署时设置 TTS_PROVIDER_ENDPOINT；密钥只保存在服务端。",
    }, { status: 503 });
  }
  try {
    const body = await request.json() as { text?: string; voice?: string; model?: string };
    const text = body.text?.trim();
    if (!text) return NextResponse.json({ ok: false, error: "缺少待合成文本" }, { status: 400 });
    if (text.length > 5000) return NextResponse.json({ ok: false, error: "单次 TTS 文本不能超过 5000 字" }, { status: 400 });
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: body.model?.trim() || config.defaultModel,
        voice: body.voice?.trim() || config.defaultVoice,
        input: text,
        response_format: "mp3",
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      return NextResponse.json({ ok: false, error: `TTS Provider 返回 ${response.status}：${detail}` }, { status: 502 });
    }
    return new NextResponse(await response.arrayBuffer(), {
      headers: {
        "Content-Type": response.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "TTS 生成失败",
    }, { status: 500 });
  }
}
