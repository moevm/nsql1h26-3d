import React, { createContext, useContext, useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "nsql-design-settings";

const DEFAULTS = {
  autoRotate: true,
  showGrid: true,
  showAxes: true,
  darkTheme: true,
  notifications: false,
  autoSave: true,
  highDensity: false,
  liveMetrics: true,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettingsState] = useState(load);

  useEffect(() => {
    save(settings);
  }, [settings]);

  const setSetting = useCallback((key, value) => {
    setSettingsState(s => ({ ...s, [key]: value }));
  }, []);

  const setSettings = useCallback((patchOrFn) => {
    setSettingsState(prev => {
      const next = typeof patchOrFn === "function" ? patchOrFn(prev) : { ...prev, ...patchOrFn };
      return next;
    });
  }, []);

  const value = { settings, setSetting, setSettings };
  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
