const DB_NAME = 'decide-ai-media';
const STORE_NAME = 'audio';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento de áudio deste navegador.'));
  });
}

export async function saveAudio(id: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('Não foi possível salvar o áudio neste navegador. Verifique o espaço disponível.'));
      tx.onabort = () => reject(new Error('O armazenamento do áudio foi interrompido.'));
    });
  } finally { db.close(); }
}

export async function loadAudio(id: string): Promise<Blob | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
      request.onerror = () => reject(new Error('Não foi possível recuperar este áudio.'));
    });
  } finally { db.close(); }
}

export async function deleteAudio(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      for (const id of ids) tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new Error('Não foi possível remover os áudios antigos.'));
    });
  } finally { db.close(); }
}
