const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

let mainWindow;

// --- アップデート関連の定数 ---
const UPDATE_DIR = path.join(app.getPath('userData'), 'updates');
const LOCAL_PKG = path.join(UPDATE_DIR, 'package.json');
const LOCAL_INDEX = path.join(UPDATE_DIR, 'index.html');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // 起動時にアップデート版（userData側）が存在するかチェック
    if (fs.existsSync(LOCAL_PKG) && fs.existsSync(LOCAL_INDEX)) {
        console.log('✨ アップデート版(userData)を検出しました。パス:', UPDATE_DIR);
        app.effectiveAppPath = UPDATE_DIR;
        mainWindow.loadFile(LOCAL_INDEX);
    } else {
        console.log('🏠 オリジナル版(AppPath)を起動します。');
        app.effectiveAppPath = app.getAppPath();
        mainWindow.loadFile('index.html');
    }

    console.log('📂 実効アプリケーションパス:', app.effectiveAppPath);

    mainWindow.on('focus', () => {
        console.log('🔍 ウィンドウフォーカス: アップデートを確認します');
        if (mainWindow) mainWindow.webContents.send('window-focused');
        checkUpdates();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.p2pfileshare.app');
    }
    createWindow();
});

// 5秒おきのチェック
setInterval(checkUpdates, 5000);

let lastUpdateNotified = 0;

async function checkUpdates() {
    if (!mainWindow) return;

    // 10秒以内の重複通知は行わない
    if (Date.now() - lastUpdateNotified < 10000) return;

    const options = {
        hostname: 'api.github.com',
        path: '/repos/Teru0822/p2p-file-share-updates/contents/package.json',
        headers: {
            'User-Agent': 'P2P-File-Share-App',
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache'
        }
    };

    https.get(options, (res) => {
        if (res.statusCode !== 200) return;

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const content = Buffer.from(json.content, 'base64').toString();
                const remotePkg = JSON.parse(content);
                const remoteVersion = remotePkg.version;

                // 現在動作中のディレクトリから package.json を読み取る
                const currentPkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
                if (!fs.existsSync(currentPkgPath)) return;

                const localPkg = JSON.parse(fs.readFileSync(currentPkgPath, 'utf8'));
                const currentVersion = localPkg.version;

                if (remoteVersion !== currentVersion) {
                    console.log(`🚀 新バージョン検出! [Local: ${currentVersion}] -> [Remote: ${remoteVersion}]`);
                    lastUpdateNotified = Date.now();
                    mainWindow.webContents.send('update-available', remoteVersion);
                } else {
                    console.log(`✅ すでに最新版です (v${currentVersion})`);
                }
            } catch (e) {
                console.error('❌ バージョン解析エラー:', e.message);
            }
        });
    }).on('error', (e) => {
        console.error('❌ GitHub API 通信エラー:', e.message);
    });
}

// IPC Handlers

// ファイル保存
ipcMain.handle('save-file', async (event, fileName, fileData) => {
    try {
        const result = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [{ name: 'All Files', extensions: ['*'] }]
        });
        if (!result.canceled && result.filePath) {
            fs.writeFileSync(result.filePath, Buffer.from(fileData));
            return { success: true, filePath: result.filePath };
        }
        return { success: false };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// アップデートダウンロード (userData/updates 固定)
ipcMain.handle('download-update', async (event, url, fileName) => {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                resolve({ success: false, error: `Status Code: ${res.statusCode}` });
                return;
            }

            let data = [];
            res.on('data', (chunk) => { data.push(chunk); });
            res.on('end', () => {
                try {
                    const buffer = Buffer.concat(data);

                    if (!fs.existsSync(UPDATE_DIR)) {
                        fs.mkdirSync(UPDATE_DIR, { recursive: true });
                    }

                    const filePath = path.join(UPDATE_DIR, fileName);
                    fs.writeFileSync(filePath, buffer);

                    if (process.platform !== 'win32' && (fileName.endsWith('.js') || fileName.endsWith('.sh'))) {
                        try { fs.chmodSync(filePath, 0o755); } catch (e) { }
                    }

                    console.log(`✅ アップデート保存完了: ${filePath}`);
                    resolve({ success: true, filePath: filePath });
                } catch (err) {
                    console.error('❌ 保存エラー:', err);
                    resolve({ success: false, error: err.message });
                }
            });
        }).on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
});

ipcMain.handle('restart-app', async () => {
    console.log('🔄 アプリを再起動します...');
    app.relaunch();
    app.exit(0);
});

ipcMain.handle('get-app-version', async () => {
    try {
        const pkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return pkg.version;
        }
    } catch (e) { }
    return app.getVersion();
});

// 他の基本的なIPC
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? { success: false } : { success: true, folderPath: result.filePaths[0] };
});

ipcMain.handle('create-directory', async (event, dirPath) => {
    try {
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('save-file-to-path', async (event, filePath, fileData) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, Buffer.from(fileData));
        return { success: true, filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});