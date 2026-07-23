import type { CompileFile, StoryProject } from "../story/types";
import { compileProject } from "../story/compiler";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`Terre ${response.status}: ${await response.text()}`);
  const type = response.headers.get("content-type") || "";
  return (type.includes("json") ? await response.json() : await response.text()) as T;
}

export type TerreGameInfo = { name: string; dir: string; cover?: string };

export class TerreClient {
  constructor(public readonly baseUrl: string) {}

  health(): Promise<unknown> {
    return request(this.baseUrl, "/api/test");
  }

  listGames(): Promise<TerreGameInfo[]> {
    return request(this.baseUrl, "/api/manageGame/gameList");
  }

  async ensureGame(project: StoryProject): Promise<{ created: boolean; gameDir: string }> {
    const gameDir = project.slug;
    const games = await this.listGames();
    if (games.some((game) => game.dir === gameDir)) return { created: false, gameDir };
    await request(this.baseUrl, "/api/manageGame/createGame", {
      method: "POST",
      body: JSON.stringify({
        gameName: project.title,
        gameDir,
        ignoreTemplate: false,
      }),
    });
    return { created: true, gameDir };
  }

  async ensureScene(gameDir: string, fileName: string): Promise<void> {
    if (fileName === "start.txt") return;
    const sceneName = fileName.replace(/\.txt$/, "");
    try {
      await request(this.baseUrl, "/api/manageGame/createNewScene", {
        method: "POST",
        body: JSON.stringify({ gameName: gameDir, sceneName }),
      });
    } catch (error) {
      if (!(error instanceof Error) || !/already exists|400/i.test(error.message)) throw error;
    }
  }

  editTextFile(path: string, content: string): Promise<unknown> {
    return request(this.baseUrl, "/api/manageGame/editTextFile", {
      method: "POST",
      body: JSON.stringify({ path, textFile: content }),
    });
  }

  async syncProject(project: StoryProject, onProgress?: (message: string, current: number, total: number) => void): Promise<{ gameDir: string; files: number }> {
    const compiled = compileProject(project);
    const game = await this.ensureGame(project);
    const files = compiled.files.filter((file) =>
      file.path.startsWith("game/") && [".txt", ".css", ".json"].some((extension) => file.path.endsWith(extension)),
    );
    let current = 0;
    for (const file of files) {
      const sceneName = file.path.match(/^game\/scene\/(.+\.txt)$/)?.[1];
      if (sceneName) await this.ensureScene(game.gameDir, sceneName);
      onProgress?.(`同步 ${file.path}`, current, files.length);
      await this.editTextFile(`games/${game.gameDir}/${file.path}`, file.content);
      current += 1;
    }
    onProgress?.("同步完成", files.length, files.length);
    return { gameDir: game.gameDir, files: files.length };
  }

  previewUrl(gameDir: string): string {
    return `${normalizeBaseUrl(this.baseUrl)}/games/${encodeURIComponent(gameDir)}/`;
  }

  exportWeb(gameDir: string): Promise<unknown> {
    return request(this.baseUrl, `/api/manageGame/ejectGameAsWeb/${encodeURIComponent(gameDir)}`);
  }
}

export type PreviewStatus = "connecting" | "connected" | "disconnected" | "error";

export class TerrePreviewSync {
  private socket?: WebSocket;
  private status: PreviewStatus = "disconnected";

  constructor(private readonly baseUrl: string, private readonly onStatus?: (status: PreviewStatus) => void) {}

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    const url = `${normalizeBaseUrl(this.baseUrl).replace(/^http/, "ws")}/api/webgalsync`;
    this.status = "connecting";
    this.onStatus?.(this.status);
    this.socket = new WebSocket(url, "webgal-editor-preview-sync.v1");
    this.socket.onopen = () => {
      this.status = "connected";
      this.onStatus?.(this.status);
    };
    this.socket.onclose = () => {
      this.status = "disconnected";
      this.onStatus?.(this.status);
    };
    this.socket.onerror = () => {
      this.status = "error";
      this.onStatus?.(this.status);
    };
  }

  syncScene(sceneName: string, sentenceId = 0): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.connect();
      return false;
    }
    this.socket.send(JSON.stringify({
      kind: "request",
      type: "preview.command.sync-scene",
      requestId: `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      payload: { sceneName, sentenceId, settleMode: "normal" },
    }));
    return true;
  }

  runSceneContent(sceneContent: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.connect();
      return false;
    }
    this.socket.send(JSON.stringify({
      kind: "request",
      type: "preview.command.run-scene-content",
      requestId: `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      payload: { sceneContent },
    }));
    return true;
  }

  dispose(): void {
    this.socket?.close();
    this.socket = undefined;
  }
}

export function webgalFileMap(files: CompileFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, file.content]));
}
