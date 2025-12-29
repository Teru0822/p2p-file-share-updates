const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');

    // 開発者ツールを自動で開く
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Windowsで通知を動作させるために必要
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.p2pfileshare.app');
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ファイル保存ダイアログ
ipcMain.handle('save-file', async (event, fileName, fileData) => {
    try {
        const result = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [
                { name: 'All Files', extensions: ['*'] }
            ]
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

// フォルダ選択ダイアログ
ipcMain.handle('select-folder', async (event) => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return { success: true, folderPath: result.filePaths[0] };
        }
        return { success: false };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ディレクトリ作成
ipcMain.handle('create-directory', async (event, dirPath) => {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 指定パスにファイル保存
ipcMain.handle('save-file-to-path', async (event, filePath, fileData) => {
    try {
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, Buffer.from(fileData));
        return { success: true, filePath: filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// アップデートダウンロード
// アップデートダウンロードと保存
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
                    // asar: false設定により、常にgetAppPath()が書き込み可能なリソースフォルダ(resources/app)を指す
                    const targetDir = app.getAppPath();

                    const filePath = path.join(targetDir, fileName);

                    // バックアップ作成 (存在する場合)
                    if (fs.existsSync(filePath)) {
                        const backupPath = filePath + '.backup';
                        fs.copyFileSync(filePath, backupPath);
                        console.log(`📦 バックアップ作成: ${fileName}`);
                    }

                    fs.writeFileSync(filePath, buffer);

                    console.log(`✅ アップデート保存: ${fileName}`);

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

// 再起動
ipcMain.handle('restart-app', async () => {
    const exePath = process.execPath;
    const args = process.argv.slice(1);

    console.log('🔄 アプリを再起動します...');
    console.log('実行パス:', exePath);

    spawn(exePath, args, {
        detached: true,
        stdio: 'ignore'
    }).unref();

    setTimeout(() => {
        app.quit();
    }, 1000);
});

// ウィンドウを前面に表示
ipcMain.on('show-window', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// フォルダを開いてファイルを選択
ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});