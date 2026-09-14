require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const https = require('https');

app.use(express.static('public'));

app.get('/api/turn', (req, res) => {
    const apiKey = process.env.METERED_API_KEY;
    if (!apiKey) {
        console.warn('METERED_API_KEY is missing from environment variables');
        return res.json([]);
    }
    
    https.get(`https://draw.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            try {
                res.json(JSON.parse(data));
            } catch (e) {
                console.error('Failed to parse TURN response');
                res.json([]);
            }
        });
    }).on('error', (err) => {
        console.error('Failed to fetch TURN servers', err);
        res.json([]);
    });
});

io.on('connection', (socket) =>{
    console.log('A user connected and id:', socket.id);

    // join a private room
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room ${roomId}`);
    });

    // broadcast the signaling data to the other peer in the room
    socket.on('webrtc_signaling', (data) => {
        socket.to(data.roomId).emit('webrtc_signaling', data);
    });
})

const PORT = process.env.PORT || 3000;
http.listen(PORT, ()=>{
    console.log(`Server is running on port ${PORT}`);
});