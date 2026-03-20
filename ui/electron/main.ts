import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GPU acceleration for Three.js
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: !isDev,
    kiosk: !isDev,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    // DevTools: press Ctrl+Shift+I to open manually when needed
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Ensure page starts at the top after loading
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript('window.scrollTo(0, 0); document.documentElement.scrollTop = 0;');
  });

  // Prevent the window from being closed with Alt+F4 in kiosk mode
  if (!isDev) {
    win.on('close', (e) => {
      e.preventDefault();
    });
  }
}

// Handle quit request from renderer
ipcMain.on('app-quit', () => {
  app.exit(0);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
