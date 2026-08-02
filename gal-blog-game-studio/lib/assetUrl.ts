import type { StoryAsset } from "./story/types";

export function resolveRegisteredAssetUrl(
  asset: StoryAsset | undefined,
  localUrls: Record<string, string> = {},
): string | undefined {
  if (!asset) return undefined;
  if (localUrls[asset.id]) return localUrls[asset.id];
  if (asset.remoteUrl) return asset.remoteUrl;
  if (/^(?:https?:|data:|blob:)/i.test(asset.path)) return asset.path;
  return asset.path.startsWith("/") ? asset.path : `/${asset.path}`;
}
