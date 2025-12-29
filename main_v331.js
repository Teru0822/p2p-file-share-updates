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

    // --- 繧｢繝・・繝・・繝医ョ繧｣繝ｬ繧ｯ繝医Μ縺ｮ蜆ｪ蜈亥愛螳・---
    const updateDir = path.join(app.getPath('userData'), 'updates');
    const localPkg = path.join(updateDir, 'package.json');
    const localIndex = path.join(updateDir, 'index.html');

    // 襍ｷ蜍墓凾縺ｫ package.json 縺ｮ蟄伜惠繧偵ｂ縺｣縺ｦ繧｢繝・・繝・・繝育沿縺ｨ蛻､螳壹☆繧・    if (fs.existsSync(localPkg) && fs.existsSync(localIndex)) {
        console.log('笨ｨ 繧｢繝・・繝・・繝育沿繧呈､懷・縺励∪縺励◆縲ゅヱ繧ｹ:', updateDir);
        app.effectiveAppPath = updateDir;
        mainWindow.loadFile(localIndex);
    } else {
        console.log('匠 繧ｪ繝ｪ繧ｸ繝翫Ν迚医ｒ襍ｷ蜍輔＠縺ｾ縺吶・);
        app.effectiveAppPath = app.getAppPath();
        mainWindow.loadFile('index.html');
    }
    console.log('唐 螳溷柑繧｢繝励Μ繧ｱ繝ｼ繧ｷ繝ｧ繝ｳ繝代せ:', app.effectiveAppPath);

    // 繝・ヰ繝・げ縺ｮ縺溘ａ髢狗匱閠・ヤ繝ｼ繝ｫ繧定・蜍輔〒髢九￥
    mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Windows縺ｧ騾夂衍繧貞虚菴懊＆縺帙ｋ縺溘ａ縺ｫ蠢・ｦ・    if (process.platform === 'win32') {
        app.setAppUserModelId('com.p2pfileshare.app');
    }
    createWindow();

    // 繧ｦ繧｣繝ｳ繝峨え縺後ヵ繧ｩ繝ｼ繧ｫ繧ｹ縺輔ｌ縺滓凾縺ｫ繧｢繝・・繝・・繝医ｒ遒ｺ隱・    mainWindow.on('focus', () => {
        console.log('剥 繧ｦ繧｣繝ｳ繝峨え繝輔か繝ｼ繧ｫ繧ｹ: 繧｢繝・・繝・・繝医ｒ遒ｺ隱阪＠縺ｾ縺・);
        mainWindow.webContents.send('window-focused'); // 繝ｬ繝ｳ繝繝ｩ繝ｼ縺ｫ騾夂衍
        checkUpdates();
    });
});

// 螳壽悄繝√ぉ繝・け (5遘・
setInterval(checkUpdates, 5000);

let lastUpdateNotified = 0;

async function checkUpdates() {
    if (!mainWindow) return;

    // 10遘剃ｻ･蜀・・驥崎､・夂衍縺ｯ陦後ｏ縺ｪ縺・(5遘帝俣髫斐・繝√ぉ繝・け縺ｫ蟇ｾ蠢・
    if (Date.now() - lastUpdateNotified < 10000) return;

    console.log('倹 GitHub縺ｫ譛譁ｰ繝舌・繧ｸ繝ｧ繝ｳ繧貞撫縺・粋繧上○荳ｭ...');

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
            console.warn(`笞・・繧｢繝・・繝・・繝育｢ｺ隱榊､ｱ謨・ Status ${res.statusCode}`);
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

                // 迴ｾ蝨ｨ縺ｮ繝ｭ繝ｼ繧ｫ繝ｫ繝舌・繧ｸ繝ｧ繝ｳ繧堤黄逅・ヵ繧｡繧､繝ｫ縺九ｉ蜿門ｾ・                const pkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
                const localPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const currentVersion = localPkg.version;

                if (remoteVersion !== currentVersion) {
                    console.log(`噫 譁ｰ繝舌・繧ｸ繝ｧ繝ｳ讀懷・! [Local: ${currentVersion}] -> [Remote: ${remoteVersion}]`);
                    lastUpdateNotified = Date.now();
                    mainWindow.webContents.send('update-available', remoteVersion);
                } else {
                    console.log(`笨・縺吶〒縺ｫ譛譁ｰ迚医〒縺・(v${currentVersion})`);
                }
            } catch (e) {
                console.error('笶・繝舌・繧ｸ繝ｧ繝ｳ隗｣譫舌お繝ｩ繝ｼ:', e.message);
            }
        });
    }).on('error', (e) => {
        console.error('笶・GitHub API 騾壻ｿ｡繧ｨ繝ｩ繝ｼ:', e.message);
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

// 繝輔ぃ繧､繝ｫ菫晏ｭ倥ム繧､繧｢繝ｭ繧ｰ
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

// 繝輔か繝ｫ繝驕ｸ謚槭ム繧､繧｢繝ｭ繧ｰ
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

// 繝・ぅ繝ｬ繧ｯ繝医Μ菴懈・
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

// 謖・ｮ壹ヱ繧ｹ縺ｫ繝輔ぃ繧､繝ｫ菫晏ｭ・ipcMain.handle('save-file-to-path', async (event, filePath, fileData) => {
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

// 繧｢繝・・繝・・繝医ム繧ｦ繝ｳ繝ｭ繝ｼ繝・// 繧｢繝・・繝・・繝医ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨→菫晏ｭ・ipcMain.handle('download-update', async (event, url, fileName) => {
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

                    // 繧｢繝・・繝・・繝亥・縺ｯ蟶ｸ縺ｫ userData/updates 縺ｫ蝗ｺ螳壹☆繧・(ASAR蝠城｡後ｒ蝗樣∩)
                    const targetDir = path.join(app.getPath('userData'), 'updates');
                    const filePath = path.join(targetDir, fileName);

                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }

                    // 遒ｺ螳溘↓譁ｰ繝・ぅ繝ｬ繧ｯ繝医Μ繧貞ｮ溷柑繝代せ縺ｨ縺励※險ｭ螳・                    app.effectiveAppPath = targetDir;

                    // 繝舌ャ繧ｯ繧｢繝・・菴懈・ (蟄伜惠縺吶ｋ蝣ｴ蜷・
                    if (fs.existsSync(filePath)) {
                        try {
                            const backupPath = filePath + '.backup';
                            fs.copyFileSync(filePath, backupPath);
                            console.log(`逃 繝舌ャ繧ｯ繧｢繝・・菴懈・: ${fileName}`);
                        } catch (e) {
                            console.warn(`笞・・繝舌ャ繧ｯ繧｢繝・・菴懈・螟ｱ謨・(邯咏ｶ壹＠縺ｾ縺・: ${e.message}`);
                        }
                    }

                    fs.writeFileSync(filePath, buffer);

                    // Linux/Mac 縺ｮ蝣ｴ蜷医∝ｮ溯｡後ヵ繧｡繧､繝ｫ縺ｪ繧画ｨｩ髯舌ｒ莉倅ｸ・(main.js縺ｪ縺ｩ縺ｮ蝣ｴ蜷・
                    if (process.platform !== 'win32' && (fileName.endsWith('.js') || fileName.endsWith('.sh'))) {
                        try {
                            fs.chmodSync(filePath, 0o755);
                        } catch (e) {
                            console.warn(`笞・・chmod螟ｱ謨・ ${e.message}`);
                        }
                    }

                    console.log(`笨・繧｢繝・・繝・・繝井ｿ晏ｭ伜ｮ御ｺ・ ${filePath}`);
                    resolve({ success: true, filePath: filePath });
                } catch (err) {
                    console.error('笶・菫晏ｭ倥お繝ｩ繝ｼ:', err);
                    resolve({ success: false, error: `繝輔ぃ繧､繝ｫ菫晏ｭ倅ｸｭ縺ｫ繧ｨ繝ｩ繝ｼ縺檎匱逕溘＠縺ｾ縺励◆: ${err.message}` });
                }
            });
        }).on('error', (err) => {
            resolve({ success: false, error: `騾壻ｿ｡繧ｨ繝ｩ繝ｼ: ${err.message}` });
        });
    });
});

// 蜀崎ｵｷ蜍・ipcMain.handle('restart-app', async () => {
    console.log('売 繧｢繝励Μ繧貞・襍ｷ蜍輔＠縺ｾ縺・(relaunch)...');
    app.relaunch();
    app.exit(0);
});

// 繧ｦ繧｣繝ｳ繝峨え繧貞燕髱｢縺ｫ陦ｨ遉ｺ
ipcMain.on('show-window', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// 繝輔か繝ｫ繝繧帝幕縺・※繝輔ぃ繧､繝ｫ繧帝∈謚・ipcMain.handle('show-item-in-folder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// 迴ｾ蝨ｨ縺ｮ繝舌・繧ｸ繝ｧ繝ｳ諠・ｱ繧貞叙蠕・(繧ｪ繝ｼ繝舌・繝ｬ繧､蟇ｾ蠢・
ipcMain.handle('get-app-version', async () => {
    try {
        const pkgPath = path.join(app.effectiveAppPath || app.getAppPath(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    } catch (e) {
        return app.getVersion();
    }
});
