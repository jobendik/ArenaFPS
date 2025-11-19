const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

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

// Seeded random number generator for consistent map generation
function seededRandom(seed) {
    let value = seed;
    return function() {
        value = (value * 9301 + 49297) % 233280;
        return value / 233280;
    };
}

// Generate obstacles using same seed as client (seed = 12345)
const MAP_SEED = 12345;
const obstacles = [];
const rng = seededRandom(MAP_SEED);
for (let i = 0; i < 40; i++) {
    const h = 5 + rng() * 10;
    const x = (rng() - 0.5) * 150;
    const z = (rng() - 0.5) * 150;
    obstacles.push({ x: x, z: z, width: 5, depth: 5, height: h });
}

// Check if line of sight between two points is blocked
function hasLineOfSight(x1, z1, x2, z2) {
    // Simple 2D ray-box intersection check
    const dx = x2 - x1;
    const dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const dirX = dx / dist;
    const dirZ = dz / dist;
    
    for (let obstacle of obstacles) {
        // Check if ray intersects with obstacle bounds
        const halfWidth = obstacle.width / 2;
        const halfDepth = obstacle.depth / 2;
        
        // Calculate closest point on ray to obstacle center
        const toObstacleX = obstacle.x - x1;
        const toObstacleZ = obstacle.z - z1;
        const dotProduct = toObstacleX * dirX + toObstacleZ * dirZ;
        
        if (dotProduct < 0 || dotProduct > dist) continue; // Obstacle not between points
        
        const closestX = x1 + dirX * dotProduct;
        const closestZ = z1 + dirZ * dotProduct;
        
        // Check if closest point is inside obstacle bounds
        if (Math.abs(closestX - obstacle.x) < halfWidth && 
            Math.abs(closestZ - obstacle.z) < halfDepth) {
            return false; // Line of sight blocked
        }
    }
    return true; // Clear line of sight
}

// AI Bots
const bots = {};
const BOT_COUNT = 3;

function createBot(id) {
    bots[id] = {
        id: id,
        x: (Math.random() - 0.5) * 100,
        y: 2,
        z: (Math.random() - 0.5) * 100,
        ry: Math.random() * Math.PI * 2,
        hp: 100,
        score: 0,
        color: playerColors[Math.floor(Math.random() * playerColors.length)],
        name: 'Bot_' + id.slice(-4),
        targetX: 0,
        targetZ: 0,
        isBot: true,
        lastShot: Date.now()
    };
    players[id] = bots[id]; // Add to players list
}

function updateBots() {
    Object.values(bots).forEach(bot => {
        // Find nearest player
        let nearestPlayer = null;
        let nearestPlayerId = null;
        let nearestDist = Infinity;
        
        Object.keys(players).forEach(playerId => {
            const p = players[playerId];
            if (playerId !== bot.id && !p.isBot && p.hp > 0 && !p.invulnerable) {
                const d = Math.sqrt((p.x - bot.x) ** 2 + (p.z - bot.z) ** 2);
                if (d < nearestDist) {
                    nearestDist = d;
                    nearestPlayer = p;
                    nearestPlayerId = playerId;
                }
            }
        });

        if (nearestPlayer) {
            // Calculate angle to player
            const angleToPlayer = Math.atan2(nearestPlayer.x - bot.x, nearestPlayer.z - bot.z);
            
            // Smooth rotation towards player
            let angleDiff = angleToPlayer - bot.ry;
            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            bot.ry += angleDiff * 0.1; // Smooth turning
            
            // AI behavior based on distance
            if (nearestDist > 40) {
                // Too far - move closer
                const dx = nearestPlayer.x - bot.x;
                const dz = nearestPlayer.z - bot.z;
                const speed = 0.2;
                bot.x += (dx / nearestDist) * speed;
                bot.z += (dz / nearestDist) * speed;
            } else if (nearestDist < 15) {
                // Too close - back up while shooting
                const dx = bot.x - nearestPlayer.x;
                const dz = bot.z - nearestPlayer.z;
                const speed = 0.15;
                bot.x += (dx / nearestDist) * speed;
                bot.z += (dz / nearestDist) * speed;
            } else if (nearestDist < 25) {
                // Good range - strafe randomly
                if (Math.random() < 0.02) {
                    const strafeAngle = bot.ry + (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
                    bot.x += Math.sin(strafeAngle) * 0.15;
                    bot.z += Math.cos(strafeAngle) * 0.15;
                }
            }
            
            // Shoot at player with burst fire
            const now = Date.now();
            if (nearestDist < 50) {
                // Check if aiming at player (within 15 degrees)
                const aimAngleDiff = Math.abs(angleDiff);
                
                if (aimAngleDiff < 0.26 && now - bot.lastShot > 200) { // ~5 shots per second
                    bot.lastShot = now;
                    
                    // Check line of sight before shooting
                    const hasLOS = hasLineOfSight(bot.x, bot.z, nearestPlayer.x, nearestPlayer.z);
                    
                    if (hasLOS) {
                        // Calculate hit chance based on distance and aim
                        let hitChance = 0.5; // Base 50% accuracy
                        hitChance -= (nearestDist / 100) * 0.3; // Reduce with distance
                        hitChance -= aimAngleDiff * 2; // Reduce if not perfectly aimed
                        hitChance = Math.max(0.15, Math.min(0.6, hitChance)); // Clamp between 15-60%
                        
                        io.emit('playerShot', { id: bot.id });
                        
                        if (Math.random() < hitChance && !nearestPlayer.invulnerable) {
                        const damage = 10;
                        nearestPlayer.hp -= damage;
                        
                        // Always emit damage event for real players
                        if (!nearestPlayer.isBot) {
                            console.log(`Bot ${bot.name} hit ${nearestPlayer.name} (ID: ${nearestPlayerId}) for ${damage} damage. HP: ${nearestPlayer.hp}`);
                            // Send damage only to the affected player
                            io.to(nearestPlayerId).emit('tookDamage', { amount: damage });
                        }
                        
                        if (nearestPlayer.hp <= 0) {
                            bot.score++;
                            io.emit('updateScore', { id: bot.id, score: bot.score });
                            io.emit('killFeed', { killer: bot.name, victim: nearestPlayer.name });
                            
                            console.log(`${nearestPlayer.name} killed by bot, respawning...`);
                            
                            // Respawn immediately on server
                            nearestPlayer.hp = 100;
                            nearestPlayer.x = (Math.random() - 0.5) * 80;
                            nearestPlayer.z = (Math.random() - 0.5) * 80;
                            nearestPlayer.invulnerable = true;
                            
                            // Remove invulnerability after 3 seconds
                            setTimeout(() => {
                                if (nearestPlayer) nearestPlayer.invulnerable = false;
                            }, 3000);
                            
                            if (!nearestPlayer.isBot) {
                                // Send respawn to everyone (so the victim resets and others see the teleport)
                                io.emit('playerRespawn', {
                                    id: nearestPlayerId,
                                    x: nearestPlayer.x,
                                    y: 2,
                                    z: nearestPlayer.z
                                });
                            }
                        }
                    }
                    }
                }
            }
        } else {
            // No players - random patrol
            if (!bot.targetX || Math.random() < 0.01) {
                bot.targetX = (Math.random() - 0.5) * 80;
                bot.targetZ = (Math.random() - 0.5) * 80;
            }
            
            const dx = bot.targetX - bot.x;
            const dz = bot.targetZ - bot.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            
            if (dist > 2) {
                const speed = 0.1;
                bot.x += (dx / dist) * speed;
                bot.z += (dz / dist) * speed;
                bot.ry = Math.atan2(dx, dz);
            }
        }

        // Broadcast bot movement
        io.emit('playerMoved', { id: bot.id, x: bot.x, y: bot.y, z: bot.z, ry: bot.ry });
    });
}

// Initialize bots
for (let i = 0; i < BOT_COUNT; i++) {
    createBot('bot_' + i);
}

// Update bots every 100ms
setInterval(updateBots, 100);

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Handle player join event
    socket.on('join', (data) => {
        // Initialize new player with data from client
        players[socket.id] = {
            x: 0, y: 2, z: 0, ry: 0,
            hp: 100,
            score: 0,
            color: data.color || playerColors[Math.floor(Math.random() * playerColors.length)],
            name: data.name || playerNames[Math.floor(Math.random() * playerNames.length)] + Math.floor(Math.random() * 100)
        };

        console.log('Player joined:', socket.id, players[socket.id].name);

        // Send init data to the new player (includes all existing players)
        socket.emit('init', {
            id: socket.id,
            players: players,
            pickups: pickups.filter(p => p.visible)
        });

        // Notify ALL OTHER players about the new player
        socket.broadcast.emit('playerJoined', {
            id: socket.id,
            data: players[socket.id]
        });
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

        if (victimId && players[victimId] && !players[victimId].invulnerable) {
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

                // Respawn victim immediately on server
                players[victimId].hp = 100;
                const respawnX = (Math.random() - 0.5) * 100;
                const respawnZ = (Math.random() - 0.5) * 100;
                
                players[victimId].x = respawnX;
                players[victimId].z = respawnZ;
                players[victimId].invulnerable = true;
                
                // Remove invulnerability after 3 seconds
                setTimeout(() => {
                    if (players[victimId]) players[victimId].invulnerable = false;
                }, 3000);

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