const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Game State
const players = {};
const pickups = [
    { id: 'health1', type: 'health', x: 10, y: 1, z: 10, visible: true },
    { id: 'ammo1', type: 'ammo', x: -10, y: 1, z: -10, visible: true },
    { id: 'health2', type: 'health', x: 20, y: 1, z: -20, visible: true },
    { id: 'ammo2', type: 'ammo', x: -20, y: 1, z: 20, visible: true },
    { id: 'health3', type: 'health', x: 0, y: 1, z: 30, visible: true },
    { id: 'ammo3', type: 'ammo', x: 0, y: 1, z: -30, visible: true },
    { id: 'ammo4', type: 'ammo', x: 30, y: 1, z: 0, visible: true },
    { id: 'health4', type: 'health', x: -30, y: 1, z: 0, visible: true }
];

const playerColors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0x00ffff, 0xff00ff];
const playerNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Initialize new player
    players[socket.id] = {
        x: 0, y: 2, z: 0, ry: 0,
        hp: 100,
        score: 0,
        color: playerColors[Math.floor(Math.random() * playerColors.length)],
        name: playerNames[Math.floor(Math.random() * playerNames.length)] + Math.floor(Math.random() * 100)
    };

    // Send init data to the new player
    socket.emit('init', {
        id: socket.id,
        players: players,
        pickups: pickups.filter(p => p.visible)
    });

    // Notify others
    socket.broadcast.emit('playerJoined', {
        id: socket.id,
        data: players[socket.id]
    });

    // Movement
    socket.on('move', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].ry = data.ry;
            socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
        }
    });

    // Shooting
    socket.on('shoot', (data) => {
        const shooter = players[socket.id];
        const victimId = data.hitId;

        io.emit('playerShot', { id: socket.id });

        if (victimId && players[victimId]) {
            const damage = 10;
            players[victimId].hp -= damage;

            // Notify victim
            io.to(victimId).emit('tookDamage', { amount: damage });

            // Check death
            if (players[victimId].hp <= 0) {
                // Update score
                shooter.score++;
                io.emit('updateScore', { id: socket.id, score: shooter.score });

                // Kill feed
                io.emit('killFeed', { killer: shooter.name, victim: players[victimId].name });

                // Respawn victim
                players[victimId].hp = 100;
                const respawnX = (Math.random() - 0.5) * 100;
                const respawnZ = (Math.random() - 0.5) * 100;

                io.emit('playerRespawn', {
                    id: victimId,
                    x: respawnX,
                    y: 2,
                    z: respawnZ
                });
            }
        }
    });

    // Pickups
    socket.on('collectPickup', (id) => {
        const pickup = pickups.find(p => p.id === id);
        if (pickup && pickup.visible) {
            pickup.visible = false;
            io.emit('pickupCollected', id);

            // Respawn pickup after 10 seconds
            setTimeout(() => {
                pickup.visible = true;
                io.emit('pickupRespawn', { id: id });
            }, 10000);
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete players[socket.id];
        io.emit('playerLeft', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});