const DATABASE_NAME = "gal-blog-game-studio-assets";
const DATABASE_VERSION = 1;
const STORE_NAME = "files";

type StoredAssetFile = {
  assetId: string;
  file: Blob;
  name: string;
  type: string;
  updatedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("当前浏览器不支持本地素材存储"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "assetId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地素材库"));
  });
}

export async function saveLocalAssetFile(assetId: string, file: File): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      assetId,
      file,
      name: file.name,
      type: file.type,
      updatedAt: new Date().toISOString(),
    } satisfies StoredAssetFile);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("素材保存失败"));
  });
  database.close();
}

export async function readLocalAssetFile(assetId: string): Promise<StoredAssetFile | undefined> {
  const database = await openDatabase();
  const result = await new Promise<StoredAssetFile | undefined>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(assetId);
    request.onsuccess = () => resolve(request.result as StoredAssetFile | undefined);
    request.onerror = () => reject(request.error || new Error("素材读取失败"));
  });
  database.close();
  return result;
}

export async function removeLocalAssetFile(assetId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(assetId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("素材删除失败"));
  });
  database.close();
}
