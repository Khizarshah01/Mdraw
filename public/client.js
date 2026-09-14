class DrawingBoard {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        this.color = '#1c1c1e';
        this.size = 6;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        
        this.onDraw = null; 
        this.onClear = null; 
        
        this.saveTimeout = null; // Used for debouncing autosave
        
        this.init();
    }

    init() {
        window.addEventListener('resize', () => this.resize());
        this.resize();
        
        // Load any saved artwork immediately when the app starts
        this.loadFromStorage();

        this.canvas.addEventListener('pointerdown', (e) => {
            this.isDrawing = true;
            this.lastX = e.offsetX;
            this.lastY = e.offsetY;
        });

        this.canvas.addEventListener('pointerup', () => this.isDrawing = false);
        this.canvas.addEventListener('pointerout', () => this.isDrawing = false);

        this.canvas.addEventListener('pointermove', (e) => {
            if (!this.isDrawing) return;
            
            this.drawLine(this.lastX, this.lastY, e.offsetX, e.offsetY, this.color, this.size);
            
            if (this.onDraw) {
                this.onDraw(this.lastX, this.lastY, e.offsetX, e.offsetY, this.color, this.size);
            }

            this.lastX = e.offsetX;
            this.lastY = e.offsetY;
        });
    }

    resize() {
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.putImageData(imgData, 0, 0);
    }

    drawLine(startX, startY, endX, endY, color, size) {
        const prevColor = this.ctx.strokeStyle;
        const prevSize = this.ctx.lineWidth;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = size;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();

        this.ctx.strokeStyle = prevColor;
        this.ctx.lineWidth = prevSize;
        
        this.triggerAutosave();
    }
    
    triggerAutosave() {
        // Wait 500ms after drawing stops before saving, so we don't freeze the browser
        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            try {
                localStorage.setItem('mdraw_saved_artwork', this.canvas.toDataURL());
            } catch (e) {
                console.warn('Storage limit reached');
            }
        }, 500);
    }
    
    loadFromStorage() {
        const savedData = localStorage.getItem('mdraw_saved_artwork');
        if (savedData) {
            const img = new Image();
            img.onload = () => {
                this.ctx.drawImage(img, 0, 0);
            };
            img.src = savedData;
        }
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        localStorage.removeItem('mdraw_saved_artwork');
    }
}

class ConnectionManager {
    constructor(roomId, isMobile) {
        this.roomId = roomId;
        this.isMobile = isMobile;
        
        this.socket = io();
        this.peer = new RTCPeerConnection({
            iceServers: [ { urls: 'stun:stun.l.google.com:19302' } ]
        });
        
        this.dataChannel = null;
        this.pendingCandidates = [];
        
        this.onDataReceived = null; 
        this.onConnected = null;    
        
        this.init();
    }

    init() {
        this.socket.on('connect', () => {
            this.socket.emit('join-room', this.roomId);
            if (this.isMobile) {
                setTimeout(() => this.socket.emit('webrtc_signaling', { type: 'ready', roomId: this.roomId }), 500);
            }
        });

        this.setupWebRTCListeners();

        if (!this.isMobile) {
            this.setupDataChannel(this.peer.createDataChannel('drawing'));
        }
        
        this.peer.ondatachannel = (e) => this.setupDataChannel(e.channel);
    }

    setupDataChannel(channel) {
        this.dataChannel = channel;
        this.dataChannel.onopen = () => { if (this.onConnected) this.onConnected(); };
        this.dataChannel.onmessage = (msg) => { if (this.onDataReceived) this.onDataReceived(JSON.parse(msg.data)); };
    }

    sendData(data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(data));
        }
    }

    setupWebRTCListeners() {
        this.peer.onicecandidate = (e) => {
            if (e.candidate) this.socket.emit('webrtc_signaling', { type: 'candidate', candidate: e.candidate, roomId: this.roomId });
        };

        this.socket.on('webrtc_signaling', async (data) => {
            if (data.type === 'ready' && !this.isMobile) {
                const offer = await this.peer.createOffer();
                await this.peer.setLocalDescription(offer);
                this.socket.emit('webrtc_signaling', { type: 'offer', offer: offer, roomId: this.roomId });
            }
            else if(data.type === 'offer' && this.isMobile) {
                await this.peer.setRemoteDescription(data.offer);
                const answer = await this.peer.createAnswer();
                await this.peer.setLocalDescription(answer);
                this.socket.emit('webrtc_signaling', { type: 'answer', answer: answer, roomId: this.roomId });
                this.flushCandidates();
            }
            else if(data.type === 'answer' && !this.isMobile) {
                await this.peer.setRemoteDescription(data.answer);
                this.flushCandidates();
            }
            else if(data.type === 'candidate') {
                if (this.peer.remoteDescription) {
                    this.peer.addIceCandidate(data.candidate).catch(console.error);
                } else {
                    this.pendingCandidates.push(data.candidate);
                }
            }
        });
    }

    flushCandidates() {
        this.pendingCandidates.forEach(c => this.peer.addIceCandidate(c));
        this.pendingCandidates = [];
    }
}

const urlParams = new URLSearchParams(window.location.search);
const isMobile = !!urlParams.get('room');
const roomId = urlParams.get('room') || Math.random().toString(36).substring(7);

const board = new DrawingBoard('board');
const connection = new ConnectionManager(roomId, isMobile);

board.onDraw = (startX, startY, endX, endY, color, size) => {
    connection.sendData({ action: 'draw', startX, startY, endX, endY, color, size });
};

connection.onDataReceived = (data) => {
    if (data.action === 'draw') board.drawLine(data.startX, data.startY, data.endX, data.endY, data.color, data.size);
    if (data.action === 'clear') board.clear();
};

connection.onConnected = () => {
    document.getElementById('qr-overlay').style.display = 'none';
};

// Popover Elements
const colorPopover = document.getElementById('color-popover');
const sizePopover = document.getElementById('size-popover');
const morePopover = document.getElementById('more-popover');
const activeColorSwatch = document.querySelector('.active-color-swatch');
const activeSizeIconSpan = document.querySelector('.active-size-icon span');

// Toggle Popovers
document.getElementById('active-color-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    colorPopover.classList.toggle('show');
    sizePopover.classList.remove('show');
    morePopover.classList.remove('show');
});

document.getElementById('active-size-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    sizePopover.classList.toggle('show');
    colorPopover.classList.remove('show');
    morePopover.classList.remove('show');
});

document.getElementById('more-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    morePopover.classList.toggle('show');
    colorPopover.classList.remove('show');
    sizePopover.classList.remove('show');
});

// Close popovers if clicking outside
document.addEventListener('click', () => {
    colorPopover.classList.remove('show');
    sizePopover.classList.remove('show');
    morePopover.classList.remove('show');
});

document.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelector('.color-swatch.active').classList.remove('active');
        e.target.classList.add('active');
        board.color = e.target.dataset.color;
        
        // Update the main button to show selected color
        activeColorSwatch.style.backgroundColor = board.color;
        
        // Tint the brush size dots
        document.querySelectorAll('.size-dot span, .active-size-icon span').forEach(dot => {
            dot.style.background = board.color;
        });
        
        colorPopover.classList.remove('show');
    });
});

document.querySelectorAll('.size-dot').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelector('.size-dot.active').classList.remove('active');
        e.currentTarget.classList.add('active');
        board.size = parseInt(e.currentTarget.dataset.size);
        
        // Update the main button to show selected size
        const dotSpan = e.currentTarget.querySelector('span');
        activeSizeIconSpan.style.width = dotSpan.style.width;
        activeSizeIconSpan.style.height = dotSpan.style.height;
        
        sizePopover.classList.remove('show');
    });
});
document.getElementById('clear-btn').addEventListener('click', () => {
    board.clear();
    connection.sendData({ action: 'clear' });
});

document.getElementById('download-btn').addEventListener('click', () => {
    // Create a temporary canvas so we can fill the background color before saving
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = board.canvas.width;
    tempCanvas.height = board.canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    
    // Fill the background with our Apple Light Gray so the image isn't transparent
    tCtx.fillStyle = '#F4F5F7';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    // Draw the artwork on top
    tCtx.drawImage(board.canvas, 0, 0);
    
    // Trigger download
    const link = document.createElement('a');
    link.download = 'Mdraw-Artwork.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(console.error);
    else document.exitFullscreen();
});

if (!isMobile) {
    let qrGenerated = false;
    document.getElementById('qr-btn').addEventListener('click', () => {
        document.getElementById('qr-overlay').style.display = 'flex';
        if (!qrGenerated) {
            const connectUrl = window.location.origin + window.location.pathname + '?room=' + roomId;
            new QRCode(document.getElementById("qrcode"), {
                text: connectUrl,
                width: 200,
                height: 200,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
            qrGenerated = true;
        }
    });

    document.getElementById('close-qr').addEventListener('click', () => {
        document.getElementById('qr-overlay').style.display = 'none';
    });
} else {
    document.getElementById('qr-btn').style.display = 'none';
    const divider = document.querySelector('.qr-divider');
    if (divider) divider.style.display = 'none';
}