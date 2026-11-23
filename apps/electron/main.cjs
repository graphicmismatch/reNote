// Electron shell: a window around the built React app (apps/desktop/dist, copied to ./renderer).
const { app, BrowserWindow, session, shell, systemPreferences } = require("electron");
const path = require("node:path");

// All data lives in this window's IndexedDB with the app holding it in memory, so a second
// instance would overwrite the first one's changes. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) app.quit();

/** Only what the app actually uses: the microphone (audio clips) and clipboard (paste). */
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-read", "clipboard-sanitized-write"]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 640,
    minHeight: 480,
    title: "reNote",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  return win;
}

app.on("second-instance", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission === "media" && process.platform === "darwin") {
      return void systemPreferences.askForMediaAccess("microphone").then(callback);
    }
    callback(true);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
