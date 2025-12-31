import { openDB } from 'idb';

const DB_NAME = 'infoverse-db';
const STORE_NAME = 'handles';

export const initDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
};

export const storeDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const db = await initDB();
  await db.put(STORE_NAME, handle, 'root_dir');
};

export const getDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | undefined> => {
  const db = await initDB();
  return db.get(STORE_NAME, 'root_dir');
};

export const clearDirectoryHandle = async () => {
  const db = await initDB();
  await db.delete(STORE_NAME, 'root_dir');
};

