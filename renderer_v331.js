const { ipcRenderer } = require('electron');
const os = require('os');
const dgram = require('dgram');
const net = require('net');
const https = require('https');

// --- Configuration & Constants ---
const CONFIG = {
    VERSION: '...', // Will be loaded dynamically from main process
    PORTS: {
        BROADCAST: 45678,
        TRANSFER: 45679
    },
    INTERVALS: {
        BROADCAST: 3000,
        PEER_TIMEOUT: 10000,
        UPDATE_CHECK: 3000 // 3遘帝俣髫斐↓遏ｭ邵ｮ
    },
    GITHUB: {
        BASE_URL: 'https://raw.githubusercontent.com/Teru0822/p2p-file-share-updates/main/',
        // GitHub API 繧剃ｽｿ逕ｨ縺励※繧ｭ繝｣繝・す繝･繧貞屓驕ｿ (Content URL)
        VERSION_URL: 'https://api.github.com/repos/Teru0822/p2p-file-share-updates/contents/package.json'
    }
};

const VERSION_INFO = {
    version: CONFIG.VERSION,
    changelog: [
        '笨・Refactored codebase for better performance',
        '笨・Improved UI responsiveness',
        '笨・Enhanced error handling',
        '笨・IPMessenger-style auto discovery',
        '笨・Folder transfer support'
    ]
};

// --- Utilities ---
const Utils = {
    getLocalIP() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    },

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    },

    playNotificationSound() {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    },

    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
};

// --- Network Logic Class ---
class NetworkManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.myName = '';
        this.myIP = '';
        this.broadcastSocket = null;
        this.transferServer = null;
        this.currentTransfer = null;
    }

    init(name, ip) {
        this.myName = name;
        this.myIP = ip;
        this.setupBroadcast();
        this.setupTransferServer();
        this.startBroadcasting();
    }

    updateName(name) {
        this.myName = name;
        this.broadcast(); // Immediately announce new name
    }

    setupBroadcast() {
        this.broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.broadcastSocket.on('error', (err) => console.error('笶・Broadcast Error:', err));

        this.broadcastSocket.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (rinfo.address !== this.myIP && data.type === 'announce') {
                    this.callbacks.onPeerDiscovered(data.name, rinfo.address);
                }
            } catch (err) { }
        });

        this.broadcastSocket.on('listening', () => {
            this.broadcastSocket.setBroadcast(true);
            console.log('笨・Broadcast Listener Ready:', CONFIG.PORTS.BROADCAST);
        });

        this.broadcastSocket.bind(CONFIG.PORTS.BROADCAST);
    }

    startBroadcasting() {
        setTimeout(() => this.broadcast(), 100);
        setInterval(() => this.broadcast(), CONFIG.INTERVALS.BROADCAST);
    }

    broadcast() {
        const message = JSON.stringify({
            type: 'announce',
            name: this.myName,
            ip: this.myIP
        });
        try {
            this.broadcastSocket.send(message, CONFIG.PORTS.BROADCAST, '255.255.255.255');
        } catch (err) { }
    }

    setupTransferServer() {
        this.transferServer = net.createServer((socket) => {
            let receivedData = Buffer.alloc(0);
            let fileInfo = null;
            let expectedSize = 0;
            let isMessage = false;

            console.log('踏 Connection received:', socket.remoteAddress);

            socket.on('data', (data) => {
                receivedData = Buffer.concat([receivedData, data]);

                if (!fileInfo && receivedData.length >= 4) {
                    const headerSize = receivedData.readUInt32BE(0);

                    if (receivedData.length >= 4 + headerSize) {
                        const headerJSON = receivedData.slice(4, 4 + headerSize).toString('utf8');
                        fileInfo = JSON.parse(headerJSON);

                        if (fileInfo.type === 'message') {
                            isMessage = true;
                            expectedSize = 0;
                            this.callbacks.onMessageReceived(fileInfo);
                            socket.end();
                            return;
                        }

                        expectedSize = fileInfo.size;
                        receivedData = receivedData.slice(4 + headerSize);
                        this.callbacks.onTransferStart(fileInfo.name, fileInfo.size);
                    }
                }

                if (fileInfo && !isMessage && expectedSize > 0) {
                    this.callbacks.onTransferProgress(receivedData.length, expectedSize);
                }
            });

            socket.on('end', async () => {
                if (isMessage) return;

                if (fileInfo && receivedData.length === expectedSize) {
                    this.callbacks.onTransferComplete();
                    const result = await ipcRenderer.invoke('save-file', fileInfo.name, Array.from(receivedData));
                    this.callbacks.onFileSaved(result, fileInfo.name);
                }
            });

            socket.on('error', (err) => {
                console.error('笶・Socket error:', err);
                this.callbacks.onTransferError(err);
            });
        });

        this.transferServer.listen(CONFIG.PORTS.TRANSFER, () => {
            console.log('笨・Transfer Server Ready:', CONFIG.PORTS.TRANSFER);
        });
    }

    cancelTransfer() {
        if (this.currentTransfer) {
            this.currentTransfer.cancelled = true;
        }
    }

    async sendMessageData(targetIP, text, filesData, targetName) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            let connected = false;

            const timeout = setTimeout(() => {
                if (!connected) {
                    client.destroy();
                    reject(new Error('Connection Timeout'));
                }
            }, 10000);

            client.connect(CONFIG.PORTS.TRANSFER, targetIP, () => {
                connected = true;
                clearTimeout(timeout);

                const metadata = {
                    type: 'message',
                    text: text,
                    from: this.myName,
                    timestamp: Date.now(),
                    fileCount: filesData.length,
                    files: filesData
                };

                const headerBuffer = Buffer.from(JSON.stringify(metadata), 'utf8');
                const headerSize = Buffer.alloc(4);
                headerSize.writeUInt32BE(headerBuffer.length, 0);

                client.write(headerSize);
                client.write(headerBuffer, () => {
                    setTimeout(() => client.end(), 100);
                });
            });

            client.on('end', () => resolve());
            client.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    sendFileData(targetIP, file, onChunkSent, onComplete) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = Buffer.from(e.target.result);
            const fileInfo = { name: file.name, type: file.type, size: file.size };

            const client = net.createConnection({ port: CONFIG.PORTS.TRANSFER, host: targetIP }, () => {
                this.callbacks.onTransferStart(file.name, file.size);

                const headerJSON = JSON.stringify(fileInfo);
                const headerBuffer = Buffer.from(headerJSON, 'utf8');
                const headerSize = Buffer.alloc(4);
                headerSize.writeUInt32BE(headerBuffer.length, 0);

                client.write(headerSize);
                client.write(headerBuffer);

                const CHUNK_SIZE = 64 * 1024;
                let offset = 0;

                const sendChunk = () => {
                    if (this.currentTransfer && this.currentTransfer.cancelled) {
                        client.end();
                        this.callbacks.onTransferCancelled();
                        return;
                    }
                    if (offset >= fileData.length) {
                        client.end();
                        this.callbacks.onTransferComplete();
                        if (onComplete) onComplete();
                        return;
                    }
                    const chunk = fileData.slice(offset, offset + CHUNK_SIZE);
                    client.write(chunk, () => {
                        offset += chunk.length;
                        onChunkSent(offset, fileData.length);
                        setTimeout(sendChunk, 10); // Throttle slightly
                    });
                };

                this.currentTransfer = { cancelled: false };
                sendChunk();
            });

            client.on('error', (err) => {
                this.callbacks.onTransferError(err);
                if (onComplete) onComplete();
            });
        };
        reader.readAsArrayBuffer(file);
    }
}

// --- UI Manager Class ---
class UIManager {
    constructor() {
        this.els = {};
    }

    cacheElements() {
        const ids = [
            'statusText', 'myName', 'peerCount', 'peerList', 'sendBar',
            'selectedCount', 'progressOverlay', 'progressTitle', 'progressFile',
            'progressBar', 'progressText', 'nameModal', 'nameInput',
            'sendModal', 'sendModalTitle', 'messageInput', 'fileAttachSection',
            'fileAttachPlaceholder', 'attachedFileList', 'receivedModal',
            'receivedFrom', 'receivedMessageBody', 'receivedFiles',
            'updateModal', 'updateModalBody', 'appVersion'
        ];
        ids.forEach(id => this.els[id] = document.getElementById(id));

        // Inputs
        this.fileInput = document.getElementById('fileInput');
        this.attachFileInput = document.getElementById('attachFileInput');
        this.attachFolderInput = document.getElementById('attachFolderInput');
    }

    renderPeerList(peers, selectedPeerIPs) {
        this.els.peerCount.textContent = peers.length;

        if (peers.length === 0) {
            this.els.peerList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">剥</div>
                    <div>繝阪ャ繝医Ρ繝ｼ繧ｯ荳翫↓繝・ヰ繧､繧ｹ縺瑚ｦ九▽縺九ｊ縺ｾ縺帙ｓ</div>
                </div>
            `;
        } else {
            this.els.peerList.innerHTML = peers.map(p => `
                <div class="peer-item" id="peer-${p.ip.replace(/\./g, '-')}"
                     ondragover="app.handleDragOver(event, '${p.ip}')"
                     ondragleave="app.handleDragLeave(event, '${p.ip}')"
                     ondrop="app.handleDrop(event, '${p.ip}')">
                    <input type="checkbox" class="peer-checkbox" 
                           ${selectedPeerIPs.has(p.ip) ? 'checked' : ''}
                           onchange="app.togglePeer('${p.ip}')">
                    <div class="peer-info">
                        <div class="peer-avatar">捗</div>
                        <div>
                            <div class="peer-name">${p.name}</div>
                            <div class="peer-ip">${p.ip}</div>
                        </div>
                    </div>
                    <button class="btn btn-send" onclick="app.openSendModal('${p.ip}', '${p.name}')">豆 騾∽ｿ｡</button>
                </div>
            `).join('');
        }
        this.updateSendBar(selectedPeerIPs.size);
    }

    updateSendBar(count) {
        if (count > 0) {
            this.els.sendBar.classList.add('show');
            this.els.selectedCount.textContent = `${count}莠ｺ`;
        } else {
            this.els.sendBar.classList.remove('show');
        }
    }

    showProgress(title, fileName, initialSize) {
        this.els.progressTitle.textContent = title;
        this.els.progressFile.textContent = fileName;
        this.updateProgressBar(0, Math.max(1, initialSize));
        this.els.progressOverlay.classList.add('show');
    }

    updateProgressBar(current, total) {
        const percent = Math.round((current / total) * 100);
        this.els.progressBar.style.width = percent + '%';
        this.els.progressBar.textContent = percent + '%';
        this.els.progressText.textContent = `${Utils.formatBytes(current)} / ${Utils.formatBytes(total)}`;
    }

    hideProgress() {
        this.els.progressOverlay.classList.remove('show');
    }

    toggleModal(modalId, show) {
        const modal = this.els[modalId];
        if (show) {
            modal.style.display = 'flex'; // Force flex
            modal.classList.add('active'); // or 'show' depending on CSS
            if (modalId === 'nameModal') modal.classList.add('show');
        } else {
            modal.classList.remove('active');
            modal.classList.remove('show');
            modal.style.display = 'none';
        }
    }

    updateAttachedFileList(attachedFiles) {
        if (attachedFiles.length === 0) {
            this.els.fileAttachPlaceholder.style.display = 'block';
            this.els.attachedFileList.style.display = 'none';
            this.els.fileAttachSection.classList.remove('has-files');
        } else {
            this.els.fileAttachPlaceholder.style.display = 'none';
            this.els.attachedFileList.style.display = 'block';
            this.els.fileAttachSection.classList.add('has-files');

            this.els.attachedFileList.innerHTML = attachedFiles.map((item, index) => {
                const file = item.file || item;
                const path = item.path || file.name;
                const isFolder = item.isFolder || false;
                const icon = isFolder ? '刀' : '塘';
                const className = isFolder ? 'file-item folder' : 'file-item';

                return `
                    <div class="${className}">
                        <div class="file-item-info">
                            <span>${icon}</span>
                            <div>
                                <div class="file-path">${path}</div>
                                <div class="file-size">${Utils.formatBytes(file.size)}</div>
                            </div>
                        </div>
                        <button class="file-remove-btn" onclick="app.removeAttachedFile(${index}); event.stopPropagation();">ﾃ・/button>
                    </div>
                `;
            }).join('');
        }
    }
}

// --- History Manager Class ---
class HistoryManager {
    constructor() {
        this.history = JSON.parse(localStorage.getItem('p2p_history') || '[]');
        this.container = document.getElementById('historyList');
    }

    addLog(type, targetName, details) {
        const log = {
            type: type, // 'send' or 'receive'
            target: targetName,
            details: details,
            timestamp: Date.now()
        };
        this.history.unshift(log);
        if (this.history.length > 50) this.history.pop();
        this.save();
        this.render();
    }

    save() {
        localStorage.setItem('p2p_history', JSON.stringify(this.history));
    }

    clear() {
        if (confirm('螻･豁ｴ繧偵☆縺ｹ縺ｦ蜑企勁縺励∪縺吶°・・)) {
            this.history = [];
            this.save();
            this.render();
        }
    }

    render() {
        if (this.history.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state" style="padding: 20px;">
                    <div style="font-size: 20px; margin-bottom: 5px;">統</div>
                    <div>螻･豁ｴ縺ｯ縺ゅｊ縺ｾ縺帙ｓ</div>
                </div>`;
            return;
        }

        this.container.innerHTML = this.history.map(log => {
            const isSend = log.type === 'send';
            const badgeClass = isSend ? 'badge-send' : 'badge-receive';
            const badgeText = isSend ? '騾∽ｿ｡' : '蜿嶺ｿ｡';
            const timeStr = new Date(log.timestamp).toLocaleString('ja-JP', {
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });

            return `
                <div class="history-item">
                    <div class="history-content">
                        <div class="history-header">
                            <span class="history-badge ${badgeClass}">${badgeText}</span>
                            <span class="history-target">${isSend ? 'To: ' : 'From: '} ${log.target}</span>
                        </div>
                        <div class="history-detail">${log.details}</div>
                    </div>
                    <div class="history-time">${timeStr}</div>
                </div>
            `;
        }).join('');
    }
}

// --- Main Application ---
class P2PApp {
    constructor() {
        this.myName = localStorage.getItem('p2p_pc_name') || os.hostname() || 'Unknown PC';
        this.myIP = Utils.getLocalIP();
        this.discoveredPeers = new Map();
        this.selectedPeers = new Set();
        this.attachedFiles = [];
        this.receivedFilesData = [];
        this.currentSendTarget = null;

        this.ui = new UIManager();
        this.history = new HistoryManager(); // Init History
        this.network = new NetworkManager({
            onPeerDiscovered: (name, ip) => this.handlePeerDiscovered(name, ip),
            onMessageReceived: (fileInfo) => this.handleMessageReceived(fileInfo),
            onTransferStart: (name, size) => this.ui.showProgress('踏 蜿嶺ｿ｡荳ｭ...', name, size),
            onTransferProgress: (current, total) => this.ui.updateProgressBar(current, total),
            onTransferComplete: () => this.ui.hideProgress(),
            onFileSaved: (result, name) => {
                Utils.playNotificationSound();
                if (result.success) {
                    // 繧ｷ繧ｹ繝・Β騾夂衍繧定｡ｨ遉ｺ
                    const notification = new Notification('塘 繝輔ぃ繧､繝ｫ繧貞女菫｡縺励∪縺励◆', {
                        body: `繝輔ぃ繧､繝ｫ: ${name}\n菫晏ｭ伜・: ${result.filePath}`,
                        icon: 'assets/icon.png' // 繧｢繧､繧ｳ繝ｳ縺後≠繧後・
                    });

                    // 繧ｯ繝ｪ繝・け縺ｧ菫晏ｭ伜・繝輔か繝ｫ繝繧帝幕縺・                    notification.onclick = () => {
                        ipcRenderer.invoke('show-item-in-folder', result.filePath);
                        window.focus();
                    };

                    alert(`笨・繝輔ぃ繧､繝ｫ蜿嶺ｿ｡螳御ｺ・ｼ―n\n繝輔ぃ繧､繝ｫ: ${name}\n菫晏ｭ伜・: ${result.filePath}`);
                }
            },
            onTransferError: (err) => {
                this.ui.hideProgress();
                alert('笶・騾壻ｿ｡繧ｨ繝ｩ繝ｼ: ' + err.message);
            },
            onTransferCancelled: () => {
                this.ui.hideProgress();
                console.log('Transfer cancelled');
            }
        });
    }

    async init() {
        // 迴ｾ蝨ｨ縺ｮ豁｣蠑上↑繝舌・繧ｸ繝ｧ繝ｳ繧貞叙蠕・(繧ｪ繝ｼ繝舌・繝ｬ繧､蟇ｾ蠢・
        CONFIG.VERSION = await ipcRenderer.invoke('get-app-version');

        console.log(`噫 P2P File Share v${CONFIG.VERSION} Started`);
        this.ui.cacheElements();

        // Initial UI State
        this.ui.els.myName.textContent = this.myName;
        this.ui.els.appVersion.textContent = `v${CONFIG.VERSION}`;
        this.ui.els.statusText.textContent = `蠕・ｩ滉ｸｭ (${this.myIP})`;
        this.history.render(); // Render initial history

        // Start Network
        this.network.init(this.myName, this.myIP);

        // Event Listeners
        this.setupEventListeners();

        // 繝｡繧､繝ｳ繝励Ο繧ｻ繧ｹ縺九ｉ縺ｮ繧｢繝・・繝・・繝磯夂衍繧貞ｾ・ｩ・        ipcRenderer.on('update-available', (event, version) => {
            console.log(`粕 [Update] 繝｡繧､繝ｳ繝励Ο繧ｻ繧ｹ縺九ｉ譁ｰ繝舌・繧ｸ繝ｧ繝ｳ v${version} 縺ｮ騾夂衍繧貞女菫｡縺励∪縺励◆縲Ａ);
            this.performUpdate(version);
        });

        // 繝輔か繝ｼ繧ｫ繧ｹ騾夂衍繧貞女菫｡
        ipcRenderer.on('window-focused', () => {
            console.log('%c笨ｨ 繧｢繝励Μ縺ｫ繝輔か繝ｼ繧ｫ繧ｹ縺輔ｌ縺ｾ縺励◆: 繧｢繝・・繝・・繝医ｒ遒ｺ隱堺ｸｭ...', 'color: #00d1b2; font-weight: bold; font-size: 1.2em;');
        });

        // 繝斐い繝ｪ繧ｹ繝医・螳壽悄譖ｴ譁ｰ縺ｮ縺ｿ谿九☆
        setInterval(() => this.updatePeerListUI(), 1000);

        // Expose to global for HTML onclick handlers
        this.exposeGlobals();

        // Request Notification Permission
        if (Notification.permission !== 'granted') {
            Notification.requestPermission();
        }
    }

    exposeGlobals() {
        // Bind methods to window.app instead of polluting global namespace directly
        // But for compatibility with minimal HTML changes, we'll map them
        // Actually, I'll update the HTML to use `app.methodName()`
    }

    setupEventListeners() {
        this.ui.els.nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.saveName();
        });

        const handleFiles = (e, isFolder) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            if (isFolder) {
                const folderFiles = files.map(file => ({
                    file: file,
                    path: (file.webkitRelativePath || file.name).replace(/\\/g, '/'),
                    isFolder: true
                }));
                this.attachedFiles.push(...folderFiles);
            } else {
                this.attachedFiles.push(...files);
            }
            this.ui.updateAttachedFileList(this.attachedFiles);
            e.target.value = '';
        };

        this.ui.attachFileInput.addEventListener('change', (e) => handleFiles(e, false));
        this.ui.attachFolderInput.addEventListener('change', (e) => handleFiles(e, true));
    }

    // --- Peer Management ---
    handlePeerDiscovered(name, ip) {
        this.discoveredPeers.set(ip, {
            name: name,
            ip: ip,
            lastSeen: Date.now()
        });
        this.updatePeerListUI();
    }

    updatePeerListUI() {
        const now = Date.now();
        for (const [ip, peer] of this.discoveredPeers) {
            if (now - peer.lastSeen > CONFIG.INTERVALS.PEER_TIMEOUT) {
                this.discoveredPeers.delete(ip);
                this.selectedPeers.delete(ip);
            }
        }
        const peers = Array.from(this.discoveredPeers.values());
        this.ui.renderPeerList(peers, this.selectedPeers);
    }

    // 繝ｬ繝ｳ繝繝ｩ繝ｼ蛛ｴ縺ｧ縺ｮ繝ｫ繝ｼ繝励・蟒・ｭ｢ (繝｡繧､繝ｳ繝励Ο繧ｻ繧ｹ縺檎ｮ｡逅・
    /*
    startUpdateLoop() {
        setInterval(() => this.updatePeerListUI(), 1000); // Check timeouts

        // 蛻晏屓繝√ぉ繝・け繧貞叉蠎ｧ縺ｫ螳溯｡・        this.checkForUpdates();

        // 莉･髯阪∝ｮ壽悄繝√ぉ繝・け
        setInterval(() => this.checkForUpdates(), CONFIG.INTERVALS.UPDATE_CHECK);
    }

    async checkForUpdates() {
        console.log('売 繧｢繝・・繝・・繝医ｒ遒ｺ隱堺ｸｭ (GitHub API)...');
        try {
            const response = await fetch(CONFIG.GITHUB.VERSION_URL, {
                cache: 'no-store',
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) return;

            const data = await response.json();
            // GitHub API 縺ｯ Base64 縺ｧ繧ｳ繝ｳ繝・Φ繝・ｒ霑斐☆縺溘ａ繝・さ繝ｼ繝峨′蠢・ｦ・            const content = atob(data.content.replace(/\s/g, ''));
            const remotePkg = JSON.parse(content);
            const remoteVersion = remotePkg.version;

            // 迴ｾ蝨ｨ縺ｮ繝ｭ繝ｼ繧ｫ繝ｫ繝舌・繧ｸ繝ｧ繝ｳ繧貞・蜿門ｾ・            const currentVersion = await ipcRenderer.invoke('get-app-version');
            CONFIG.VERSION = currentVersion;

            console.log(`[UpdateCheck] Current: ${currentVersion}, Remote: ${remoteVersion}`);

            if (remoteVersion !== currentVersion) {
                console.log('噫 繝舌・繧ｸ繝ｧ繝ｳ縺ｮ蟾ｮ逡ｰ繧呈､懷・縺励∪縺励◆・・夂衍繧呈ｺ門ｙ縺励∪縺・..');
                this.performUpdate(remoteVersion);
            }
        } catch (err) {
            console.error('Update check failed:', err);
        }
    }
    */

    compareVersions(v1, v2) {
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
            const n1 = p1[i] || 0;
            const n2 = p2[i] || 0;
            if (n1 > n2) return 1;
            if (n1 < n2) return -1;
        }
        return 0;
    }

    async performUpdate(newVersion) {
        // 莠碁㍾螳溯｡後・驥崎､・夂衍髦ｲ豁｢
        if (this.isUpdating) return;
        if (this.lastNotifiedVersion === newVersion) return;
        this.lastNotifiedVersion = newVersion;

        console.log(`粕 繧｢繝励Μ蜀・い繝・・繝・・繝医・繝・・繧｢繝・・繧定｡ｨ遉ｺ: ${newVersion}`);

        this.ui.els.updateModalBody.innerHTML = `
            譁ｰ縺励＞繝舌・繧ｸ繝ｧ繝ｳ <b>(${newVersion})</b> 縺悟・髢九＆繧後∪縺励◆縲・br>
            迴ｾ蝨ｨ縺ｮ繝舌・繧ｸ繝ｧ繝ｳ: ${CONFIG.VERSION}<br><br>
            縲御ｻ翫☆縺先峩譁ｰ縲阪ｒ繧ｯ繝ｪ繝・け縺吶ｋ縺ｨ縲∵怙譁ｰ縺ｮ繝・・繧ｿ繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｦ繧｢繝励Μ繧貞・襍ｷ蜍輔＠縺ｾ縺吶・        `;
        this.ui.toggleModal('updateModal', true);
    }

    startUpdateFromModal() {
        this.ui.toggleModal('updateModal', false);
        this.executeAutoUpdate(this.lastNotifiedVersion);
    }

    async executeAutoUpdate(newVersion) {
        if (this.isUpdating) return;
        this.isUpdating = true;

        this.ui.showProgress('噫 繧｢繝・・繝・・繝井ｸｭ...', '譛譁ｰ繝・・繧ｿ繧偵ム繧ｦ繝ｳ繝ｭ繝ｼ繝峨＠縺ｦ縺・∪縺・, 100);

        const filesToUpdate = ['index.html', 'renderer.js', 'styles.css', 'main.js', 'package.json'];
        let successCount = 0;
        let errors = [];

        for (const file of filesToUpdate) {
            try {
                this.ui.updateProgressBar(successCount + 1, filesToUpdate.length);
                this.ui.els.progressText.textContent = `繝繧ｦ繝ｳ繝ｭ繝ｼ繝我ｸｭ: ${file}`;

                const url = CONFIG.GITHUB.BASE_URL + file + '?t=' + Date.now();
                const result = await ipcRenderer.invoke('download-update', url, file);

                if (result.success) {
                    successCount++;
                } else {
                    console.error(`Failed to update ${file}:`, result.error);
                    errors.push(`${file}: ${result.error}`);
                }
            } catch (err) {
                console.error(`Error updating ${file}:`, err);
                errors.push(`${file}: ${err.message}`);
            }
        }

        this.ui.hideProgress();

        if (successCount === filesToUpdate.length) {
            // 蜈ｨ繝輔ぃ繧､繝ｫ謌仙粥
            ipcRenderer.invoke('restart-app');
        } else if (successCount > 0) {
            // 荳驛ｨ謌仙粥 (荳肴紛蜷医・蜿ｯ閭ｽ諤ｧ縺後≠繧九′邯咏ｶ壹ｒ謇楢ｨｺ)
            const proceed = confirm(`笞・・荳驛ｨ縺ｮ繝輔ぃ繧､繝ｫ縺ｮ譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆縲・n\n繧ｨ繝ｩ繝ｼ蜀・ｮｹ:\n${errors.join('\n')}\n\n縺薙・縺ｾ縺ｾ蜀崎ｵｷ蜍輔＠縺ｾ縺吶°・滂ｼ域耳螂ｨ縺励∪縺帙ｓ・荏);
            if (proceed) {
                ipcRenderer.invoke('restart-app');
            } else {
                this.isUpdating = false;
            }
        } else {
            // 蜈ｨ貊・            alert(`笶・繧｢繝・・繝・・繝医↓螟ｱ謨励＠縺ｾ縺励◆縲・n\n荳ｻ縺ｪ蜴溷屏:\n${errors.join('\n')}`);
            this.isUpdating = false;
        }
    }

    togglePeer(ip) {
        if (this.selectedPeers.has(ip)) this.selectedPeers.delete(ip);
        else this.selectedPeers.add(ip);
        this.ui.updateSendBar(this.selectedPeers.size);
    }

    clearSelection() {
        this.selectedPeers.clear();
        this.updatePeerListUI();
    }

    // --- Send Logic ---
    sendToSelected() {
        if (this.selectedPeers.size === 0) return alert('騾∽ｿ｡蜈医ｒ驕ｸ謚槭＠縺ｦ縺上□縺輔＞');

        if (this.selectedPeers.size === 1) {
            const targetIP = Array.from(this.selectedPeers)[0];
            const peer = this.discoveredPeers.get(targetIP);
            this.openSendModal(targetIP, peer.name);
        } else {
            // Bulk file send
            const fileInput = this.ui.fileInput;
            fileInput.onchange = (e) => {
                const files = Array.from(e.target.files);
                if (files.length > 0) {
                    this.sendFilesToMultiple(Array.from(this.selectedPeers), files);
                }
                e.target.value = '';
            };
            fileInput.click();
        }
    }

    openSendModal(ip, name) {
        this.currentSendTarget = { ip, name };
        this.ui.els.sendModalTitle.textContent = `${name} 縺ｸ騾∽ｿ｡`;
        this.ui.toggleModal('sendModal', true);
        this.attachedFiles = [];
        this.ui.updateAttachedFileList([]);
        this.ui.els.messageInput.value = '';
        setTimeout(() => this.ui.els.messageInput.focus(), 50);
    }

    closeSendModal() {
        this.ui.toggleModal('sendModal', false);
        this.currentSendTarget = null;
        this.attachedFiles = [];
    }

    async sendMessage() {
        const text = this.ui.els.messageInput.value.trim();
        if (!text && this.attachedFiles.length === 0) return alert('繝｡繝・そ繝ｼ繧ｸ縺ｾ縺溘・繝輔ぃ繧､繝ｫ繧呈欠螳壹＠縺ｦ縺上□縺輔＞');
        if (!this.currentSendTarget) return;

        const { ip, name } = this.currentSendTarget;
        const filesToSend = [...this.attachedFiles];
        this.closeSendModal();

        try {
            this.ui.showProgress('豆 騾∽ｿ｡荳ｭ...', `${name} 縺ｫ繝｡繝・そ繝ｼ繧ｸ繧帝∽ｿ｡縺励※縺・∪縺兪, 0);

            const filesData = [];
            for (const item of filesToSend) {
                const file = item.file || item;
                const path = item.path || file.name;
                const data = await Utils.readFileAsArrayBuffer(file);
                filesData.push({
                    name: file.name,
                    path: path,
                    type: file.type,
                    size: file.size,
                    data: Array.from(new Uint8Array(data)),
                    isFolder: item.isFolder || false
                });
            }

            await this.network.sendMessageData(ip, text, filesData, name);

            // 螻･豁ｴ縺ｫ霑ｽ蜉
            let details = text;
            if (filesData.length > 0) {
                const fileSummary = filesData.length === 1 ? filesData[0].name : `${filesData.length}蛟九・繝輔ぃ繧､繝ｫ`;
                details = text ? `${text} (梼 ${fileSummary})` : `梼 ${fileSummary}`;
            }
            this.history.addLog('send', name, details);

            this.ui.hideProgress();
            alert('笨・騾∽ｿ｡螳御ｺ・ｼ・);
        } catch (err) {
            this.ui.hideProgress();
            alert('笶・騾∽ｿ｡繧ｨ繝ｩ繝ｼ: ' + err.message);
        }
    }

    sendFilesToMultiple(targets, files) {
        let targetIndex = 0, fileIndex = 0;

        const sendNext = () => {
            if (targetIndex >= targets.length) {
                return alert(`笨・蜈ｨ騾∽ｿ｡螳御ｺ・ｼ―n\n騾∽ｿ｡蜈・ ${targets.length}蜿ｰ\n繝輔ぃ繧､繝ｫ謨ｰ: ${files.length}`);
            }
            if (fileIndex >= files.length) {
                targetIndex++;
                fileIndex = 0;
                return setTimeout(sendNext, 500);
            }

            this.network.sendFileData(targets[targetIndex], files[fileIndex],
                (current, total) => this.ui.updateProgressBar(current, total),
                () => {
                    fileIndex++;
                    setTimeout(sendNext, 500);
                }
            );
        };
        sendNext();
    }

    // --- Receive Logic ---
    handleMessageReceived(info) {
        Utils.playNotificationSound();

        // 螻･豁ｴ縺ｫ霑ｽ蜉
        let details = info.text || '';
        if (info.files && info.files.length > 0) {
            const fileSummary = info.files.length === 1 ? info.files[0].name : `${info.files.length}蛟九・繝輔ぃ繧､繝ｫ`;
            details = details ? `${details} (梼 ${fileSummary})` : `梼 ${fileSummary}`;
        }
        if (!details) details = '・医Γ繝・そ繝ｼ繧ｸ縺ｪ縺暦ｼ・;

        this.history.addLog('receive', info.from, details);

        // 繧ｷ繧ｹ繝・Β騾夂衍繧定｡ｨ遉ｺ
        const notification = new Notification('鐙 繝｡繝・そ繝ｼ繧ｸ縺悟ｱ翫″縺ｾ縺励◆', {
            body: `From: ${info.from}\n${info.text || (info.files ? '繝輔ぃ繧､繝ｫ縺梧ｷｻ莉倥＆繧後※縺・∪縺・ : '')}`,
        });

        notification.onclick = () => {
            ipcRenderer.send('show-window'); // 繝｡繧､繝ｳ繝励Ο繧ｻ繧ｹ縺ｫ繧ｦ繧｣繝ｳ繝峨え陦ｨ遉ｺ繧剃ｾ晞ｼ
            window.focus();
            this.ui.toggleModal('receivedModal', true);
        };

        this.ui.els.receivedFrom.textContent = `From: ${info.from}`;
        this.ui.els.receivedMessageBody.textContent = info.text || '・医Γ繝・そ繝ｼ繧ｸ縺ｪ縺暦ｼ・;

        this.receivedFilesData = info.files || [];
        this.renderReceivedFiles(this.receivedFilesData);
        this.ui.toggleModal('receivedModal', true);
    }

    renderReceivedFiles(files) {
        const container = this.ui.els.receivedFiles;
        if (!files || files.length === 0) {
            container.innerHTML = '';
            return;
        }

        const folders = {};
        const standaloneFiles = [];

        files.forEach((file, index) => {
            if (file.path && file.path.includes('/')) {
                const folderName = file.path.split('/')[0];
                if (!folders[folderName]) folders[folderName] = [];
                folders[folderName].push({ file, index });
            } else {
                standaloneFiles.push({ file, index });
            }
        });

        let html = '';
        Object.keys(folders).forEach(folderName => {
            const folderFiles = folders[folderName];
            const totalSize = folderFiles.reduce((sum, item) => sum + item.file.size, 0);
            html += `
                <div class="received-file-item folder">
                    <div>
                        <div style="font-weight:bold;">刀 ${folderName}</div>
                        <div style="font-size:12px;color:#666;">${folderFiles.length}蛟・(${Utils.formatBytes(totalSize)})</div>
                    </div>
                    <button class="received-file-save-btn" onclick="app.saveFolderFiles('${folderName}')">沈 繝輔か繝ｫ繝菫晏ｭ・/button>
                </div>`;
        });

        standaloneFiles.forEach(({ file, index }) => {
            html += `
                <div class="received-file-item">
                    <div>
                        <div style="font-weight:bold;">塘 ${file.name}</div>
                        <div style="font-size:12px;color:#666;">${Utils.formatBytes(file.size)}</div>
                    </div>
                    <button class="received-file-save-btn" onclick="app.saveReceivedFile(${index})">沈 菫晏ｭ・/button>
                </div>`;
        });

        container.innerHTML = `<div style="margin-top:15px;padding-top:15px;border-top:1px solid #e5e7eb;">
            <div style="font-weight:bold;margin-bottom:10px;">梼 豺ｻ莉倥ヵ繧｡繧､繝ｫ</div>${html}</div>`;
    }

    async saveReceivedFile(index) {
        const file = this.receivedFilesData[index];
        if (!file) return;
        try {
            const result = await ipcRenderer.invoke('save-file', file.name, file.data);
            if (result.success) alert(`笨・菫晏ｭ伜ｮ御ｺ・ｼ―n${result.filePath}`);
        } catch (err) { alert('笶・菫晏ｭ倥お繝ｩ繝ｼ: ' + err.message); }
    }

    async saveFolderFiles(folderName) {
        const folderFiles = this.receivedFilesData.filter(f => f.path && f.path.startsWith(folderName + '/'));
        if (folderFiles.length === 0) return;

        try {
            const result = await ipcRenderer.invoke('select-folder');
            if (!result.success) return;

            let savedCount = 0;
            for (const file of folderFiles) {
                const saveResult = await ipcRenderer.invoke('save-file-to-path', `${result.folderPath}/${file.path}`, file.data);
                if (saveResult.success) savedCount++;
            }
            alert(`笨・菫晏ｭ伜ｮ御ｺ・ｼ―n${savedCount}繝輔ぃ繧､繝ｫ繧剃ｿ晏ｭ倥＠縺ｾ縺励◆`);
        } catch (err) { alert('笶・菫晏ｭ倥お繝ｩ繝ｼ: ' + err.message); }
    }

    closeReceivedModal() {
        this.ui.toggleModal('receivedModal', false);
    }

    copyReceivedMessage() {
        const text = this.ui.els.receivedMessageBody.textContent;
        if (text) navigator.clipboard.writeText(text).then(() => alert('笨・繧ｳ繝斐・縺励∪縺励◆'));
    }

    // --- Name Edit ---
    openNameModal() {
        this.ui.els.nameInput.value = this.myName;
        this.ui.toggleModal('nameModal', true);
        this.ui.els.nameInput.focus();
    }

    closeNameModal() {
        this.ui.toggleModal('nameModal', false);
    }

    saveName() {
        const newName = this.ui.els.nameInput.value.trim();
        if (newName) {
            this.myName = newName;
            localStorage.setItem('p2p_pc_name', newName);
            this.ui.els.myName.textContent = newName;
            this.network.updateName(newName);
            this.closeNameModal();
        }
    }

    // --- Drag & Drop Wrappers ---
    handleDragOver(e, ip) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('peer-' + ip.replace(/\./g, '-')).classList.add('drag-over');
    }
    handleDragLeave(e, ip) {
        e.preventDefault();
        document.getElementById('peer-' + ip.replace(/\./g, '-')).classList.remove('drag-over');
    }
    handleDrop(e, ip) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById('peer-' + ip.replace(/\./g, '-')).classList.remove('drag-over');
        const files = [];
        if (e.dataTransfer.items) {
            for (let i = 0; i < e.dataTransfer.items.length; i++) {
                if (e.dataTransfer.items[i].kind === 'file') files.push(e.dataTransfer.items[i].getAsFile());
            }
        }
        if (files.length > 0) this.sendFilesToMultiple([ip], files);
    }

    handleFileAttachDragOver(e) {
        e.preventDefault(); e.stopPropagation();
        this.ui.els.fileAttachSection.style.borderColor = '#667eea';
        this.ui.els.fileAttachSection.style.background = '#f9fafb';
    }
    handleFileAttachDragLeave(e) {
        e.preventDefault(); e.stopPropagation();
        this.ui.updateAttachedFileList(this.attachedFiles); // Reset styles
    }
    handleFileAttachDrop(e) {
        e.preventDefault(); e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        this.attachedFiles.push(...files);
        this.ui.updateAttachedFileList(this.attachedFiles);
    }

    removeAttachedFile(index) {
        this.attachedFiles.splice(index, 1);
        this.ui.updateAttachedFileList(this.attachedFiles);
    }

    cancelTransfer() {
        this.network.cancelTransfer();
        this.ui.hideProgress();
    }

    clearHistory() {
        this.history.clear();
    }
}

// Initialize
const app = new P2PApp();
window.app = app; // Expose to window for inline HTML events
document.addEventListener('DOMContentLoaded', async () => await app.init());
