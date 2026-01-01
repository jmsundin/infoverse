// localStorage keys for UI settings
const KEYS = {
  THEME: 'infoverse_theme',
  LANGUAGE: 'infoverse_language',
  LAST_DIR_NAME: 'infoverse_last_dir_name',
  AI_PROVIDER: 'ai_provider',
  SKIP_DELETE_CONFIRM: 'infoverse_skip_delete_confirm',
  MIGRATED_V2: 'infoverse_migrated_v2',
} as const;

export type Theme = 'dark' | 'light' | 'system';
export type Language = 'en' | 'es' | 'fr' | 'de' | 'zh' | 'ja';
export type AIProvider = 'gemini' | 'huggingface';

export interface UserSettings {
  theme: Theme;
  language: Language;
  lastDirName: string | null;
  aiProvider: AIProvider;
  skipDeleteConfirm: boolean;
}

const isBrowser = typeof window !== 'undefined';

// Theme
export const getTheme = (): Theme => {
  if (!isBrowser) return 'dark';
  const stored = localStorage.getItem(KEYS.THEME);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'dark';
};

export const setTheme = (theme: Theme): void => {
  if (!isBrowser) return;
  localStorage.setItem(KEYS.THEME, theme);
};

// Language
export const getLanguage = (): Language => {
  if (!isBrowser) return 'en';
  const stored = localStorage.getItem(KEYS.LANGUAGE);
  if (stored && ['en', 'es', 'fr', 'de', 'zh', 'ja'].includes(stored)) {
    return stored as Language;
  }
  return 'en';
};

export const setLanguage = (language: Language): void => {
  if (!isBrowser) return;
  localStorage.setItem(KEYS.LANGUAGE, language);
};

// Last directory name (for display when permission needed)
export const getLastDirName = (): string | null => {
  if (!isBrowser) return null;
  return localStorage.getItem(KEYS.LAST_DIR_NAME);
};

export const setLastDirName = (name: string | null): void => {
  if (!isBrowser) return;
  if (name) {
    localStorage.setItem(KEYS.LAST_DIR_NAME, name);
  } else {
    localStorage.removeItem(KEYS.LAST_DIR_NAME);
  }
};

// AI Provider
export const getAIProvider = (): AIProvider => {
  if (!isBrowser) return 'gemini';
  const stored = localStorage.getItem(KEYS.AI_PROVIDER);
  if (stored === 'gemini' || stored === 'huggingface') {
    return stored;
  }
  return 'gemini';
};

export const setAIProvider = (provider: AIProvider): void => {
  if (!isBrowser) return;
  localStorage.setItem(KEYS.AI_PROVIDER, provider);
};

// Skip delete confirmation
export const getSkipDeleteConfirm = (): boolean => {
  if (!isBrowser) return false;
  return localStorage.getItem(KEYS.SKIP_DELETE_CONFIRM) === 'true';
};

export const setSkipDeleteConfirm = (skip: boolean): void => {
  if (!isBrowser) return;
  if (skip) {
    localStorage.setItem(KEYS.SKIP_DELETE_CONFIRM, 'true');
  } else {
    localStorage.removeItem(KEYS.SKIP_DELETE_CONFIRM);
  }
};

// Migration flag
export const isMigratedV2 = (): boolean => {
  if (!isBrowser) return false;
  return localStorage.getItem(KEYS.MIGRATED_V2) === 'true';
};

export const setMigratedV2 = (): void => {
  if (!isBrowser) return;
  localStorage.setItem(KEYS.MIGRATED_V2, 'true');
};

// Cleanup legacy localStorage (remove old graph data)
export const cleanupLegacyStorage = (): void => {
  if (!isBrowser) return;
  localStorage.removeItem('wiki-graph-data');
};

// Get all settings
export const getSettings = (): UserSettings => ({
  theme: getTheme(),
  language: getLanguage(),
  lastDirName: getLastDirName(),
  aiProvider: getAIProvider(),
  skipDeleteConfirm: getSkipDeleteConfirm(),
});

// Save partial settings
export const saveSettings = (settings: Partial<UserSettings>): void => {
  if (settings.theme !== undefined) setTheme(settings.theme);
  if (settings.language !== undefined) setLanguage(settings.language);
  if (settings.lastDirName !== undefined) setLastDirName(settings.lastDirName);
  if (settings.aiProvider !== undefined) setAIProvider(settings.aiProvider);
  if (settings.skipDeleteConfirm !== undefined) setSkipDeleteConfirm(settings.skipDeleteConfirm);
};
