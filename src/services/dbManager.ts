import { openDB, IDBPDatabase } from 'idb';
import { Note } from '../types';

const DB_NAME = 'composer-db';
const DB_VERSION = 6;
const STORE_NOTES = 'notes';
const STORE_PROJECTS = 'projects';
const STORE_SYNC_LEDGERS = 'sync_ledgers';
const STORE_SETTINGS = 'settings';

let dbPromise: Promise<IDBPDatabase<any>>;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
          }
        }
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains(STORE_SYNC_LEDGERS)) {
            db.createObjectStore(STORE_SYNC_LEDGERS, { keyPath: 'id' });
          }
        }
        if (oldVersion < 6) {
          if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
            db.createObjectStore(STORE_SETTINGS);
          }
        }
      },
    });
  }
  return dbPromise;
};

export const getAllNotes = async (): Promise<Note[]> => {
  const db = await initDB();
  return db.getAll(STORE_NOTES);
};

export const saveNote = async (note: Note) => {
  const db = await initDB();
  await db.put(STORE_NOTES, note);
};

export const deleteNote = async (id: string) => {
  const db = await initDB();
  await db.delete(STORE_NOTES, id);
};

export const bulkSaveNotes = async (notes: Note[]) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NOTES, 'readwrite');
  await Promise.all(notes.map(note => tx.store.put(note)));
  await tx.done;
};

export const bulkDeleteNotes = async (ids: string[]) => {
  const db = await initDB();
  const tx = db.transaction(STORE_NOTES, 'readwrite');
  await Promise.all(ids.map(id => tx.store.delete(id)));
  await tx.done;
};

// Project methods
export const getAllProjects = async (): Promise<any[]> => {
  const db = await initDB();
  return db.getAll(STORE_PROJECTS);
};

export const saveProject = async (project: any) => {
  const db = await initDB();
  await db.put(STORE_PROJECTS, project);
};

export const deleteProject = async (id: string) => {
  const db = await initDB();
  // Delete project
  await db.delete(STORE_PROJECTS, id);
  // Delete associated notes
  const notes = await getNotesByProject(id);
  const noteIds = notes.map(n => n.id);
  if (noteIds.length > 0) {
    await bulkDeleteNotes(noteIds);
  }
};

export const getProject = async (id: string): Promise<any | null> => {
  const db = await initDB();
  return db.get(STORE_PROJECTS, id);
};

export const getNotesByProject = async (projectId: string): Promise<Note[]> => {
  const allNotes = await getAllNotes();
  return allNotes.filter(n => n.projectId === projectId);
};

// Settings methods
export const getSetting = async (key: string): Promise<any | null> => {
  const db = await initDB();
  return db.get(STORE_SETTINGS, key);
};

export const saveSetting = async (key: string, value: any) => {
  const db = await initDB();
  await db.put(STORE_SETTINGS, value, key);
};
