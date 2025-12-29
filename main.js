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

    // --- アップデートディレクトリの優先判定 ---
    const updateDir = path.join(app.getPath('userData'), 'updates');
    const localPkg = path.join(updateDir, 'package.json');
    const localIndex = path.join(updateDir, 'index.html');

    // 起動時に package.json の存在をもってアップデート版と判定する
    if (fs.existsSync(localPkg) && fs.existsSync(localIndex)) {
        console.log('✨ アップデート版を検出しました。パス:', updateDir);
        app.effectiveAppPath = updateDir;
        mainWindow.loadFile(localIndex);
    } else {
        console.log('🏠 オリジナル版を起動します。');
        app.effectiveAppPath = app.getAppPath();
        mainWindow.loadFile('index.html');
    }
    console.log('📂 実効アプリケーションパス:', app.effectiveAppPath);

    // デバッグのため開発者ツールを自動で開く
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

    // ウィンドウがフォーカスされた時にアップデートを確認
    mainWindow.on('focus', () => {
        console.log('🔍 ウィンドウフォーカス: アップデートを確認します');
        mainWindow.webContents.send('window-focused'); // レンダラーに通知
        checkUpdates();
    });
});

// 定期チェック (5秒)
setInterval(checkUpdates, 5000);

let lastUpdateNotified = 0;

async function checkUpdates() {
    if (!mainWindow) return;

    // 10秒以内の重複通知は行わない (5秒間隔のチェックに対応)
    if (Date.now() - lastUpdateNotified < 10000) return;

    console.log('🌐 GitHubに最新バージョンを問い合わせ中...');

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
        if (res.statusCode !== 200) {
            console.warn(`⚠️ アップデート確認失敗: Status ${res.statusCode}`);
            return;
        }

        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const content = Buffer.from(json.content, 'base64').toString();
                const remotePkg = JSON.parse(content);
                const remoteVersion = remotePkg.version;

                // 現在のローカルバージョンを物理ファイルから取得
                const pkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
                const localPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
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

                    // アップデート先は常に userData/updates に固定する (ASAR問題を回避)
                    const targetDir = path.join(app.getPath('userData'), 'updates');
                    const filePath = path.join(targetDir, fileName);

                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }

                    // 確実に新ディレクトリを実効パスとして設定
                    app.effectiveAppPath = targetDir;

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
    console.log('🔄 アプリを再起動します (relaunch)...');
    app.relaunch();
    app.exit(0);
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

// 現在のバージョン情報を取得 (オーバーレイ対応)
ipcMain.handle('get-app-version', async () => {
    try {
        const pkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    } catch (e) {
        return app.getVersion();
    }
});