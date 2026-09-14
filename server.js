const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

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