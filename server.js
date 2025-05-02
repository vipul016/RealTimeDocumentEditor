const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files
app.use(express.static('public'));

// Store active users and their rooms
const activeUsers = new Map();
const roomUsers = new Map();
const roomContent = new Map();
const userColors = new Map();
const roomVersions = new Map();

// Helper function to get room users
function getRoomUsers(room) {
    if (!roomUsers.has(room)) {
        roomUsers.set(room, new Map());
    }
    return Array.from(roomUsers.get(room).values());
}

// Helper function to broadcast room users
function broadcastRoomUsers(room) {
    const users = getRoomUsers(room);
    io.to(room).emit('roomUsers', users);
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    // Handle joining a room
    socket.on('join', (data) => {
        if (data.room && data.userName) {
            socket.join(data.room);
            
            // Store user data
            activeUsers.set(socket.id, { room: data.room, userName: data.userName });
            if (!roomUsers.has(data.room)) {
                roomUsers.set(data.room, new Map());
            }
            roomUsers.get(data.room).set(socket.id, data.userName);
            
            // Send current room content to the joining user
            const currentRoomContent = roomContent.get(data.room);
            if (currentRoomContent) {
                socket.emit('contentUpdate', {
                    content: currentRoomContent.content,
                    version: currentRoomContent.version,
                    timestamp: currentRoomContent.timestamp
                });
            }
            
            // Notify other users in the room
            socket.to(data.room).emit('userJoined', {
                userName: data.userName
            });
            
            // Send current users list to all users in the room
            broadcastRoomUsers(data.room);
        }
    });

    // Handle cursor movement
    socket.on('cursorMove', (data) => {
        if (data.room) {
            // Store the user's cursor position
            if (!roomUsers.has(data.room)) {
                roomUsers.set(data.room, new Map());
            }
            
            const userData = roomUsers.get(data.room).get(socket.id) || {};
            userData.cursorPosition = data.position;
            roomUsers.get(data.room).set(socket.id, userData);
            
            // Broadcast cursor position to all clients in the room except the sender
            socket.to(data.room).emit('cursorMove', {
                userName: data.userName,
                position: data.position,
                color: data.color
            });
        }
    });

    // Handle content updates
    socket.on('contentUpdate', (data) => {
        if (data.room) {
            // Store the latest content for the room
            roomContent.set(data.room, {
                content: data.content,
                version: data.version,
                timestamp: data.timestamp
            });
            
            // Broadcast the update to all clients in the room except the sender
            socket.to(data.room).emit('contentUpdate', {
                content: data.content,
                userName: data.userName,
                version: data.version,
                position: data.position,
                timestamp: data.timestamp
            });
        }
    });

    // Handle typing status
    socket.on('typing', ({ room, userName }) => {
        try {
            // Store the user's typing status
            if (!roomUsers.has(room)) {
                roomUsers.set(room, new Map());
            }
            
            const userData = roomUsers.get(room).get(socket.id) || {};
            userData.userName = userName;
            userData.isTyping = true;
            roomUsers.get(room).set(socket.id, userData);
            
            // Broadcast to all users in the room except the sender
            socket.to(room).emit('userTyping', { 
                userName: userName 
            });
        } catch (error) {
            console.error('Error in typing handler:', error);
        }
    });

    socket.on('stopTyping', ({ room, userName }) => {
        try {
            // Update the user's typing status
            if (roomUsers.has(room)) {
                const userData = roomUsers.get(room).get(socket.id) || {};
                userData.userName = userName;
                userData.isTyping = false;
                roomUsers.get(room).set(socket.id, userData);
            }
            
            // Broadcast to all users in the room except the sender
            socket.to(room).emit('userStoppedTyping', { 
                userName: userName 
            });
        } catch (error) {
            console.error('Error in stopTyping handler:', error);
        }
    });

    // Handle document download request
    socket.on('downloadDocument', ({ room, content }) => {
        try {
            // Send the document content back to the requesting user
            socket.emit('documentContent', { content });
        } catch (error) {
            console.error('Error in downloadDocument handler:', error);
            socket.emit('error', { message: 'Failed to download document' });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected');
        
        try {
            const user = activeUsers.get(socket.id);
            if (user) {
                const { room, userName } = user;
                
                // Remove user from room's user list
                if (roomUsers.has(room)) {
                    roomUsers.get(room).delete(socket.id);
                    
                    // If room is empty, remove it
                    if (roomUsers.get(room).size === 0) {
                        roomUsers.delete(room);
                        roomContent.delete(room); // Clean up room content
                    } else {
                        // Broadcast updated users list to remaining users
                        broadcastRoomUsers(room);
                    }
                }
                
                // Notify others in the room
                socket.to(room).emit('userLeft', { 
                    userName,
                    color: userColors.get(socket.id)
                });
                
                // Clean up user data
                activeUsers.delete(socket.id);
                userColors.delete(socket.id);
                
                console.log(`User ${userName} left room ${room}`);
            }
        } catch (error) {
            console.error('Error in disconnect handler:', error);
        }
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
        socket.emit('error', { message: 'An error occurred' });
    });
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Access the application at:');
    console.log(`- Local: http://localhost:${PORT}`);
    console.log(`- Network: http://${require('os').networkInterfaces()['en0']?.[1]?.address || 'localhost'}:${PORT}`);
}); 