import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

import { buildRuntimePackage, type WebGalRuntimeManifest } from "../lib/story/exporter";
import { exampleProject } from "../lib/story/example";
import { deepClone } from "../lib/story/utils";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = join(root, "artifacts", "export-v1");
const unpacked = join(artifacts, "unpacked");
const smokePublic = join(root, "public", "export-smoke");

const project = deepClone(exampleProject);
project.version = "1.0.0";
project.settings.blogBridge = {
  enabled: true,
  allowedOrigins: ["http://localhost:4321", "http://terminal.local:4173"],
  channel: "gal-blog-game",
  timeoutMs: 20000,
  capabilities: ["return-menu", "open-article", "save-progress", "open-comment-form", "get-runtime-data"],
};
project.variables = [
  { id: "player_name", name: "player_name", type: "string", defaultValue: "主人", scope: "save" },
  { id: "visit_count", name: "visit_count", type: "number", defaultValue: 0, scope: "global" },
];
project.records = [{ id: "met_alice", name: "见过爱丽丝" }];
project.savePoints = [{ id: "save_after_return", name: "重逢之后", sceneId: "scene_teatime" }];
const teaScene = project.scenes.find((scene) => scene.id === "scene_teatime");
teaScene?.blocks.splice(2, 0, { id: "save_after_return_block", type: "save-point", savePointId: "save_after_return", auto: true });

const runtime = JSON.parse(await readFile(join(root, "public", "vendor", "webgal", "runtime-manifest.json"), "utf8")) as WebGalRuntimeManifest;
const runtimeFiles = Object.fromEntries(await Promise.all(runtime.files.map(async (file) => [
  file.path,
  new Uint8Array(await readFile(join(root, "public", "vendor", "webgal", file.path))),
] as const)));
const assetFiles = Object.fromEntries(await Promise.all(project.assets.map(async (asset) => [
  asset.id,
  new Uint8Array(await readFile(join(root, "public", asset.path))),
] as const)));

const result = await buildRuntimePackage(project, runtime, runtimeFiles, assetFiles);
await rm(artifacts, { recursive: true, force: true });
await rm(smokePublic, { recursive: true, force: true });
await mkdir(unpacked, { recursive: true });
await mkdir(smokePublic, { recursive: true });
await writeFile(join(artifacts, result.fileName), new Uint8Array(await result.blob.arrayBuffer()));

const zipped = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
for (const [path, bytes] of Object.entries(zipped)) {
  const destination = join(unpacked, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  const smokeDestination = join(smokePublic, path);
  await mkdir(dirname(smokeDestination), { recursive: true });
  await writeFile(smokeDestination, bytes);
}

await writeFile(join(smokePublic, "host.html"), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Gal Blog Bridge Smoke Host</title>
<style>html,body{margin:0;height:100%;background:#15141b;color:#eee;font:14px system-ui}main{display:grid;height:100%;grid-template-rows:auto 1fr}.bar{display:flex;gap:16px;align-items:center;padding:10px 14px;background:#23212c}.bar b{color:#c8bdf5}.bar pre{margin:0;font-size:11px;color:#9fd7bb}iframe{width:100%;height:100%;border:0}</style></head>
<body><main><div class="bar"><b id="status">WAITING FOR HELLO</b><pre id="events"></pre></div><iframe id="game" title="Alice export smoke"></iframe></main>
<script type="module">
const protocol="gal-blog-bridge/v1",channel="gal-blog-game",gameId="${result.manifest.game.id}",releaseId="${result.manifest.game.releaseId}",sessionId="smoke-session";
const params=new URLSearchParams(location.search),kind=params.get("kind")||"start",id=params.get("id")||"start",probe=params.get("probe")||"";
const target={kind,id},game=document.getElementById("game"),status=document.getElementById("status"),events=document.getElementById("events");let seq=0;
const send=(message)=>game.contentWindow.postMessage({protocol,channel,source:"gal-blog",gameId,releaseId,sessionId,...message},location.origin);
addEventListener("message",(event)=>{const m=event.data;if(event.origin!==location.origin||event.source!==game.contentWindow||!m||m.protocol!==protocol||m.channel!==channel||m.gameId!==gameId||m.releaseId!==releaseId||m.sessionId!==sessionId)return;
events.textContent=(events.textContent+" "+m.type).trim();
if(m.type==="hello")send({type:"launch",id:"host-"+(++seq),payload:{target,state:{variables:{player_name:"测试玩家",visit_count:7},records:["met_alice"]}}});
if(m.type==="ready"){status.textContent="READY · "+m.payload.target.kind+":"+m.payload.target.id;document.body.dataset.ready="true";
if(probe==="save")game.contentWindow.GalBlogBridgeV1.request("save-progress",{target:{kind:"save-point",id:"save_after_return"},variables:{player_name:"测试玩家"},records:["met_alice"]}).then(result=>{status.textContent="SAVE · "+result.status;});
if(probe==="unsupported")game.contentWindow.GalBlogBridgeV1.request("get-runtime-data",{key:"heartRate"}).then(result=>{status.textContent="UNSUPPORTED · "+result.status;});}
if(m.type==="request"){const action=m.payload&&m.payload.action;send({type:"result",replyTo:m.id,payload:action==="save-progress"?{status:"success",saveId:"smoke-save"}:{status:"unsupported",action}});}
});
game.src="./index.html?session="+encodeURIComponent(sessionId)+"&v="+encodeURIComponent(releaseId);
</script></body></html>\n`);

const summary = {
  schema: "gal-blog-export-sample/v1",
  runtimeZip: result.fileName,
  releaseId: result.manifest.game.releaseId,
  allowedHostOrigins: result.manifest.bridge.allowedHostOrigins,
  localCommand: "python -m http.server 8000 --directory unpacked",
  blogDestination: `public/games/${project.slug}/${result.manifest.game.releaseId}/`,
  registry: { slug: project.slug, releaseId: result.manifest.game.releaseId, directory: result.manifest.game.releaseId },
};
await writeFile(join(artifacts, "manifest-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(join(artifacts, "README.md"), `# Alice export v1 sample\n\n- Runtime ZIP: \`${result.fileName}\`\n- releaseId: \`${result.manifest.game.releaseId}\`\n- Blog path: \`${summary.blogDestination}\`\n- Local: \`${summary.localCommand}\`\n`);

console.log(JSON.stringify(summary, null, 2));
