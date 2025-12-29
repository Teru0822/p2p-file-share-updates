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

    // 書き込み可能なアップデートディレクトリを確認
    const updateDir = path.join(app.getPath('userData'), 'updates');
    const localIndex = path.join(updateDir, 'index.html');

    if (fs.existsSync(localIndex)) {
        console.log('✨ アップデート版の index.html を読み込みます:', localIndex);
        mainWindow.loadFile(localIndex);
    } else {
        mainWindow.loadFile('index.html');
    }

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
                    let targetDir = app.getAppPath();

                    // 書き込み権限チェック
                    let isWritable = true;
                    try {
                        fs.accessSync(targetDir, fs.constants.W_OK);
                    } catch (e) {
                        isWritable = false;
                        console.log(`⚠️ インストール先 ${targetDir} に書き込み権限がありません。userDataを使用します。`);
                        targetDir = path.join(app.getPath('userData'), 'updates');
                        if (!fs.existsSync(targetDir)) {
                            fs.mkdirSync(targetDir, { recursive: true });
                        }
                    }

                    const filePath = path.join(targetDir, fileName);

                    // バックアップ作成 (存在する場合)
                    if (fs.existsSync(filePath)) {
                        try {
                            const backupPath = filePath + '.backup';
                            fs.copyFileSync(filePath, backupPath);
                            console.log(`📦 バックアップ作成: ${fileName}`);
                        } catch (e) {
                            console.warn(`⚠️ バックアップ作成失敗 (継続します): ${e.message}`);
                        }
                    }

                    fs.writeFileSync(filePath, buffer);

                    // Linux/Mac の場合、実行ファイルなら権限を付与 (main.jsなどの場合)
                    if (process.platform !== 'win32' && (fileName.endsWith('.js') || fileName.endsWith('.sh'))) {
                        try {
                            fs.chmodSync(filePath, 0o755);
                        } catch (e) {
                            console.warn(`⚠️ chmod失敗: ${e.message}`);
                        }
                    }

                    console.log(`✅ アップデート保存完了: ${filePath}`);
                    resolve({ success: true, filePath: filePath });
                } catch (err) {
                    console.error('❌ 保存エラー:', err);
                    resolve({ success: false, error: `ファイル保存中にエラーが発生しました: ${err.message}` });
                }
            });
        }).on('error', (err) => {
            resolve({ success: false, error: `通信エラー: ${err.message}` });
        });
    });
});

// 再起動
ipcMain.handle('restart-app', async () => {
    // AppImageの場合、process.env.APPIMAGE が元のパスを指す
    const exePath = process.env.APPIMAGE || process.execPath;
    const args = process.argv.slice(1);

    console.log('🔄 アプリを再起動します...');
    console.log('実行パス:', exePath);
    console.log('OS Plataform:', process.platform);

    try {
        if (process.platform === 'linux' || process.platform === 'darwin') {
            // Linux/Mac では chmod を念のため確認 (配布形式によっては必要)
            if (fs.existsSync(exePath)) {
                try { fs.chmodSync(exePath, 0o755); } catch (e) { }
            }
        }

        const child = spawn(exePath, args, {
            detached: true,
            stdio: 'ignore',
            shell: process.platform === 'win32' ? false : true // Linuxではshell経由の方が安定する場合がある
        });

        child.unref();

        // 少し待ってから終了 (ファイルの書き込み完了を確実にするため)
        setTimeout(() => {
            app.quit();
        }, 1500);
    } catch (err) {
        console.error('再起動に失敗しました:', err);
        // 失敗しても終了はさせる (手動起動を促すため)
        app.quit();
    }
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