import type {
  AspectRatioId,
  CaptionStyle,
  ExportBitrateMbps,
  ResolutionId,
  SavedTemplate,
} from './types';

const DB_NAME = 'CaptionStudioFontsDB';
const DB_VERSION = 2;
const FONT_STORE = 'fonts';
const ASSET_STORE = 'assets';
const LOGO_ASSET_KEY = 'channel_logo_watermark';

const IMAGES_DB_NAME = 'CaptionStudioImagesDB';
const IMAGES_DB_VERSION = 1;
const IMAGES_STORE = 'studio_images';

const SETTINGS_KEY = 'captionstudio_persisted_settings_v4';
const TEMPLATES_KEY = 'captionstudio_saved_templates_v1';

export interface StoredCustomFont {
  id: string;
  label: string;
  familyName: string;
  fileName: string;
  buffer: ArrayBuffer;
  addedAt: number;
}

export interface StoredLogoAsset {
  id: string;
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
  addedAt: number;
}

export interface StoredStudioImage {
  id: string;
  name: string;
  mimeType: string;
  buffer: ArrayBuffer;
  addedAt: number;
}

export interface PersistedStudioSettings {
  style: Partial<CaptionStyle>;
  aspectId?: AspectRatioId;
  resolutionId?: ResolutionId;
  bitrateMbps?: ExportBitrateMbps;
  selectedImageId?: string;
}

function openStudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FONT_STORE)) {
        db.createObjectStore(FONT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open CaptionStudioFontsDB'));
  });
}

function openImagesDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment'));
      return;
    }
    const req = indexedDB.open(IMAGES_DB_NAME, IMAGES_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMAGES_STORE)) {
        db.createObjectStore(IMAGES_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open CaptionStudioImagesDB'));
  });
}

// --- Permanent Custom Fonts in CaptionStudioFontsDB ---

export async function loadSavedFontsFromDb(): Promise<StoredCustomFont[]> {
  try {
    const db = await openStudioDatabase();
    return await new Promise<StoredCustomFont[]>((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readonly');
      const req = tx.objectStore(FONT_STORE).getAll();
      req.onsuccess = () => {
        const list = (req.result as StoredCustomFont[]) ?? [];
        resolve(list.sort((a, b) => a.addedAt - b.addedAt));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function saveFontToDb(font: StoredCustomFont): Promise<void> {
  const db = await openStudioDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).put(font);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save font to IndexedDB'));
    };
  });
}

export async function deleteFontFromDb(id: string): Promise<void> {
  const db = await openStudioDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FONT_STORE, 'readwrite');
    tx.objectStore(FONT_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete font from IndexedDB'));
    };
  });
}

export async function registerFontFace(familyName: string, buffer: ArrayBuffer): Promise<void> {
  const face = new FontFace(familyName, buffer.slice(0));
  const loaded = await face.load();
  document.fonts.add(loaded);
}

// --- Permanent Channel Logo Watermark Storage in IndexedDB ---

export async function loadSavedLogoFromDb(): Promise<StoredLogoAsset | null> {
  try {
    const db = await openStudioDatabase();
    return await new Promise<StoredLogoAsset | null>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, 'readonly');
      const req = tx.objectStore(ASSET_STORE).get(LOGO_ASSET_KEY);
      req.onsuccess = () => resolve((req.result as StoredLogoAsset | undefined) ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function saveLogoToDb(fileName: string, mimeType: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openStudioDatabase();
  const record: StoredLogoAsset = {
    id: LOGO_ASSET_KEY,
    fileName,
    mimeType,
    buffer,
    addedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save logo to IndexedDB'));
    };
  });
}

export async function deleteLogoFromDb(): Promise<void> {
  const db = await openStudioDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE, 'readwrite');
    tx.objectStore(ASSET_STORE).delete(LOGO_ASSET_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete logo from IndexedDB'));
    };
  });
}

// --- Permanent Studio Image Library in CaptionStudioImagesDB ---

export async function loadSavedStudioImagesFromDb(): Promise<StoredStudioImage[]> {
  try {
    const db = await openImagesDatabase();
    return await new Promise<StoredStudioImage[]>((resolve, reject) => {
      const tx = db.transaction(IMAGES_STORE, 'readonly');
      const req = tx.objectStore(IMAGES_STORE).getAll();
      req.onsuccess = () => {
        const list = (req.result as StoredStudioImage[]) ?? [];
        resolve(list.sort((a, b) => b.addedAt - a.addedAt));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function saveStudioImageToDb(img: StoredStudioImage): Promise<void> {
  const db = await openImagesDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).put(img);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to save studio image to CaptionStudioImagesDB'));
    };
  });
}

export async function deleteStudioImageFromDb(id: string): Promise<void> {
  const db = await openImagesDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Failed to delete studio image from CaptionStudioImagesDB'));
    };
  });
}

// --- Persisted Studio Settings & Saved Custom Templates in localStorage ---

export function loadPersistedSettings(): PersistedStudioSettings | null {
  try {
    const raw =
      localStorage.getItem(SETTINGS_KEY) ??
      localStorage.getItem('captionstudio_persisted_settings_v3') ??
      localStorage.getItem('captionstudio_persisted_settings_v2');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedStudioSettings;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedSettings(settings: PersistedStudioSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveTemplatesList(templates: SavedTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch {
    // Ignore storage quota errors
  }
}
