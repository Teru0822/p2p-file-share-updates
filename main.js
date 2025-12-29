const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

app.whenReady().then(createWindow);

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
ipcMain.handle('download-update', async (event, url, version) => {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    let targetDir;
                    if (app.isPackaged) {
                        targetDir = path.dirname(process.execPath);
                    } else {
                        targetDir = app.getAppPath();
                    }
                    
                    const filePath = path.join(targetDir, 'index.html');
                    
                    if (fs.existsSync(filePath)) {
                        const backupPath = path.join(targetDir, 'index.html.backup');
                        fs.copyFileSync(filePath, backupPath);
                        console.log('📦 バックアップ作成:', backupPath);
                    }
                    
                    fs.writeFileSync(filePath, data, 'utf8');
                    
                    console.log('✅ アップデート保存:', filePath);
                    console.log('📝 バージョン:', version);
                    
                    resolve({ success: true, filePath: filePath, version: version });
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