import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { PointerSource, PointerSourceOverrides } from "@renote/canvas-engine";
import type { ThemeMode } from "@renote/ui";

const STORAGE_KEY = "renote:settings";

/** Default autosave cadence for a first-run/corrupt-settings user: frequent enough to matter as
 *  a safety net, infrequent enough not to hammer disk on every keystroke's debounced save. */
const DEFAULT_AUTOSAVE_INTERVAL_SECONDS = 30;

/**
 * The persisted shape of app-level (chrome/behavior) settings — distinct from document data,
 * which goes through `StorageClient`/the Rust backend per the plan's storage philosophy.
 * These are client-local UI/behavior preferences (not synced, not per-notebook), so
 * `localStorage` is the right home, not a Tauri command.
 */
interface PersistedSettings {
  pointerSourceOverrides: PointerSourceOverrides;
  /** How often to autosave the open page, in whole seconds. `0` turns autosave off. */
  autosaveIntervalSeconds: number;
  /** Light/dark chrome. Seeds `ThemeProvider`'s `defaultMode` on startup (see `AppProviders`);
   *  the live mode after that lives in `ThemeProvider`'s own state. */
  themeMode: ThemeMode;
  /** Whether `PenTool` tries to recognize a drawn shape and commit it instead of raw ink
   *  (Phase 10.1). Off by default: a plain pen keeps producing ink unless opted in. */
  recognizeShapes: boolean;
}

const DEFAULT_SETTINGS: PersistedSettings = {
  pointerSourceOverrides: {},
  autosaveIntervalSeconds: DEFAULT_AUTOSAVE_INTERVAL_SECONDS,
  themeMode: "light",
  recognizeShapes: false,
};

function loadPersistedSettings(): PersistedSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      pointerSourceOverrides: parsed.pointerSourceOverrides ?? {},
      autosaveIntervalSeconds:
        typeof parsed.autosaveIntervalSeconds === "number" && parsed.autosaveIntervalSeconds >= 0
          ? parsed.autosaveIntervalSeconds
          : DEFAULT_AUTOSAVE_INTERVAL_SECONDS,
      themeMode: parsed.themeMode === "dark" ? "dark" : "light",
      recognizeShapes: parsed.recognizeShapes === true,
    };
  } catch {
    // Corrupt/unparsable stored value — fall back to defaults rather than crashing the app
    // over a settings blob the user never edited directly.
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(settings: PersistedSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can throw (private browsing, quota exceeded) — settings just won't
    // survive a restart, which isn't worth crashing over.
  }
}

interface SettingsContextValue {
  /**
   * Stable mutable object — never replaced, only its fields are mutated. `PageEngine`/
   * `PointerInputDispatcher` hold onto this exact reference and read it live on every pointer
   * event (see `PointerSourceOverrides`'s doc comment in canvas-engine), so a change made here
   * applies to the very next event without needing to recreate the engine mid-session.
   */
  pointerSourceOverridesRef: MutableRefObject<PointerSourceOverrides>;
  /** Reactive snapshot for rendering the Settings UI — a new object on every change (safe for
   *  React's equality checks), always kept in sync with `pointerSourceOverridesRef`. */
  pointerSourceOverrides: PointerSourceOverrides;
  /** `target: null` clears the override for that source (back to trusting whatever the
   *  OS/browser reports). */
  setPointerSourceOverride: (source: PointerSource, target: PointerSource | null) => void;
  /** How often to autosave the open page, in whole seconds. `0` turns autosave off. */
  autosaveIntervalSeconds: number;
  setAutosaveIntervalSeconds: (seconds: number) => void;
  /** Only the STARTUP mode — read once by `AppProviders` to seed `ThemeProvider`. Toggling the
   *  theme means calling both this (so it survives a restart) and `useTheme().setMode`. */
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /** Same live-mutable-object idiom as `pointerSourceOverridesRef`: `PenTool` holds this exact
   *  ref and reads `.current` fresh on every stroke commit, so toggling applies to the very next
   *  stroke without recreating the engine/tool. */
  recognizeShapesRef: MutableRefObject<boolean>;
  /** Reactive snapshot for the Settings UI, kept in sync with `recognizeShapesRef`. */
  recognizeShapes: boolean;
  setRecognizeShapes: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  // Lazy-initialized once, not re-read on every render.
  const [initial] = useState(loadPersistedSettings);
  const pointerSourceOverridesRef = useRef<PointerSourceOverrides>(initial.pointerSourceOverrides);
  const [pointerSourceOverrides, setPointerSourceOverridesState] = useState<PointerSourceOverrides>(
    initial.pointerSourceOverrides,
  );
  const [autosaveIntervalSeconds, setAutosaveIntervalSecondsState] = useState<number>(
    initial.autosaveIntervalSeconds,
  );
  // Mirrors `pointerSourceOverridesRef`'s reasoning: lets each setter read the OTHER setting's
  // latest value without depending on the other's state (which would otherwise force both
  // setters to be recreated on every unrelated change, or risk a stale closure).
  const autosaveIntervalSecondsRef = useRef<number>(initial.autosaveIntervalSeconds);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(initial.themeMode);
  const themeModeRef = useRef<ThemeMode>(initial.themeMode);
  const recognizeShapesRef = useRef<boolean>(initial.recognizeShapes);
  const [recognizeShapes, setRecognizeShapesState] = useState<boolean>(initial.recognizeShapes);

  const setPointerSourceOverride = useCallback((source: PointerSource, target: PointerSource | null) => {
    const next = { ...pointerSourceOverridesRef.current };
    if (target === null) {
      delete next[source];
    } else {
      next[source] = target;
    }
    // Mutate the existing ref object's fields in place — see its doc comment on why this
    // can't just be `pointerSourceOverridesRef.current = next`.
    if (target === null) {
      delete pointerSourceOverridesRef.current[source];
    } else {
      pointerSourceOverridesRef.current[source] = target;
    }
    setPointerSourceOverridesState(next);
    persistSettings({
      pointerSourceOverrides: next,
      autosaveIntervalSeconds: autosaveIntervalSecondsRef.current,
      themeMode: themeModeRef.current,
      recognizeShapes: recognizeShapesRef.current,
    });
  }, []);

  const setAutosaveIntervalSeconds = useCallback((seconds: number) => {
    autosaveIntervalSecondsRef.current = seconds;
    setAutosaveIntervalSecondsState(seconds);
    persistSettings({
      pointerSourceOverrides: pointerSourceOverridesRef.current,
      autosaveIntervalSeconds: seconds,
      themeMode: themeModeRef.current,
      recognizeShapes: recognizeShapesRef.current,
    });
  }, []);

  const setThemeMode = useCallback((next: ThemeMode) => {
    themeModeRef.current = next;
    setThemeModeState(next);
    persistSettings({
      pointerSourceOverrides: pointerSourceOverridesRef.current,
      autosaveIntervalSeconds: autosaveIntervalSecondsRef.current,
      themeMode: next,
      recognizeShapes: recognizeShapesRef.current,
    });
  }, []);

  const setRecognizeShapes = useCallback((value: boolean) => {
    recognizeShapesRef.current = value;
    setRecognizeShapesState(value);
    persistSettings({
      pointerSourceOverrides: pointerSourceOverridesRef.current,
      autosaveIntervalSeconds: autosaveIntervalSecondsRef.current,
      themeMode: themeModeRef.current,
      recognizeShapes: value,
    });
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      pointerSourceOverridesRef,
      pointerSourceOverrides,
      setPointerSourceOverride,
      autosaveIntervalSeconds,
      setAutosaveIntervalSeconds,
      themeMode,
      setThemeMode,
      recognizeShapesRef,
      recognizeShapes,
      setRecognizeShapes,
    }),
    [
      pointerSourceOverrides,
      setPointerSourceOverride,
      autosaveIntervalSeconds,
      setAutosaveIntervalSeconds,
      themeMode,
      setThemeMode,
      recognizeShapes,
      setRecognizeShapes,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider.");
  }
  return context;
}
