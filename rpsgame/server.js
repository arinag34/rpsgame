const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname + '/public'));

const games = {};
const playersRating = {};



function isPlayerInFile(playerName, filename) {
    try {
        const fileContent = fs.readFileSync(filename, 'utf8');
        const players = fileContent.split('\n').map(player => player.trim());
        return players.includes(playerName);
    } catch (error) {
        console.error('Error reading file:', error);
        return false;
    }
}

function isRoomInFile(roomId, filename) {
    try {
        const fileContent = fs.readFileSync(filename, 'utf8');
        const rooms = fileContent.split('\n').map(room => room.trim());
        return rooms.includes(roomId);
    } catch (error) {
        console.error('Error reading file:', error);
        return false;
    }
}

// Додати функцію для визначення переможця
function determineWinners(choices) {
    const distinctChoices = Array.from(new Set(choices));
    if (distinctChoices.length === 1) {
        return null; // Немає переможця, вибори однакові
    }

    const winningCombinations = [['rock', 'scissors'], ['paper', 'rock'], ['scissors', 'paper']];
    for (const combination of winningCombinations) {
        if (choices.includes(combination[0]) && choices.includes(combination[1])) {
            return combination[0]; // Переможець
        }
    }

    return null; // Немає переможця
}


io.on('connection', (socket) => {
    let roomId; // Зберігатиме ID кімнати гри
    let playerId; // Зберігатиме ID гравця
    let roundTimer;
    let gameTimer;

    socket.on('join', (gameId, playerName) => {
        if (!games[gameId]) {
            games[gameId] = {
                players: {},
                choices: {},
            };
        }

        games[gameId].players[socket.id] = playerName;

        io.to(socket.id).emit('message', `Welcome, ${playerName}!`);

        if (Object.keys(games[gameId].players).length === 2) {
            io.to(gameId).emit('message', 'Game is ready. Make your move!');
        }

        socket.join(gameId);
        if (!playersRating[playerName]) {
            playersRating[playerName] = 0;
        }

        if (!isPlayerInFile(playerName, 'C:\\Users\\Admin\\Desktop\\лабы мережтехн\\лаб2\\database\\player.txt')) {
            // Якщо гравця немає в файлі, додати його
            fs.appendFileSync('C:\\Users\\Admin\\Desktop\\лабы мережтехн\\лаб2\\database\\player.txt', `\n${playerName}`);
            io.to(gameId).emit('message', `You are successfully registered!`);
        }
        if (!isRoomInFile(gameId, 'C:\\Users\\Admin\\Desktop\\лабы мережтехн\\лаб2\\database\\room.txt')) {
            // Якщо кімнати немає в файлі, додати її
            fs.appendFileSync('C:\\Users\\Admin\\Desktop\\лабы мережтехн\\лаб2\\database\\room.txt', `${gameId}\n`);
            io.to(gameId).emit('message', `The room is successfully registered!`);
        }


        roomId = `game:${gameId}`;
        playerId = socket.id;

        // Додати гравця до кімнати гри
        socket.join(roomId);

        startRoundTimer(gameId);
        startGameTimer(gameId);

        socket.on('disconnect', () => {
            if (games[gameId] && games[gameId].players && games[gameId].players[playerId]) {
                const playerName = games[gameId].players[playerId];

                // Видалити гравця з гри
                delete games[gameId].players[playerId];

                // Оповістити інших гравців про видалення
                io.to(roomId).emit('message', `${playerName} left the game.`);

                // Перевірити, чи в грі залишилося достатньо гравців
                if (Object.keys(games[gameId].players).length < 2) {
                    // Якщо залишилося менше двох гравців, закрити гру
                    io.to(roomId).emit('message', 'Not enough players. Closing the game.');
                    delete games[gameId];
                } else {
                    // Якщо гравець від'єднався під час раунду, запустити таймер для наступного раунду
                    clearTimeout(roundTimer);
                    startRoundTimer(gameId);
                }
            }
        });
    });

    socket.on('choice', (gameId, choice) => {
        clearTimeout(roundTimer);

        // Додати вибір до гри
        games[gameId].choices[socket.id] = choice;

        const choices = Object.values(games[gameId].choices);

        if (choices.length === Object.keys(games[gameId].players).length) {
            const winner = determineWinners(choices);

            if (winner) {
                const winners = Object.keys(games[gameId].choices).filter((id) => games[gameId].choices[id] === winner);
                winners.forEach((id) => {
                    const winnerName = games[gameId].players[id];
                    playersRating[winnerName] += 5; // За кожну перемогу дається 5 балів
                });

                const winnerNames = winners.map((id) => games[gameId].players[id]);
                io.to(gameId).emit('message', `${winnerNames.join(', ')} win(s) this round with ${winner}!`);
                io.to(gameId).emit('rating', playersRating);
                // Переможець отримує ставку від інших гравців (якщо є)
                const losers = Object.keys(games[gameId].players).filter((id) => !winners.includes(id));

                if (losers.length > 0) {
                    const loserNames = losers.map((id) => games[gameId].players[id]);
                    io.to(winners[0]).emit('message', `You won the bet from ${loserNames.join(', ')}!`);
                    io.to(losers).emit('message', `You lost the bet to ${winnerNames.join(', ')}!`);
                }
                // Перезапустити гру для наступного раунду
                games[gameId].choices = {};
                io.to(gameId).emit('message', 'Next round! Make your move!');
                startRoundTimer(gameId);
            } else {
                // Якщо немає переможця і вибори однакові - нічія
                if (new Set(choices).size === 1) {
                    io.to(gameId).emit('message', 'It\'s a tie! Next round!');
                    games[gameId].choices = {}; // Запускаємо новий раунд
                    io.to(gameId).emit('message', 'Make your move!');
                    startRoundTimer(gameId);
                } else {
                    // Якщо немає переможця і вибори різні, чекати на решту ставок
                    io.to(socket.id).emit('message', 'Waiting for other players to make their move...');
                    startRoundTimer(gameId);
                }
            }
        }
    });

    function startRoundTimer(gameId) {
        roundTimer = setTimeout(() => {
            // Якщо таймер вичерпався, визначити програвшого і розпочати новий раунд
            const players = Object.keys(games[gameId].players);
            const missingPlayers = players.filter((player) => !games[gameId].choices[player]);

            missingPlayers.forEach((missingPlayer) => {
                io.to(gameId).emit('message', `${games[gameId].players[missingPlayer]} ran out of time. They lose this round. Next round!`);
            });

            // Очистити вибори
            games[gameId].choices = {};

            // Запустити таймер для нового раунду
            startRoundTimer(gameId);
        }, 10000); // 10000 мс = 10 секунд
    }

    function startGameTimer(gameId) {
        gameTimer = setTimeout(() => {
            const playerName = games[gameId].players[playerId];

            delete games[gameId].players[playerId];
            delete games[gameId].choices[playerId];

            io.to(gameId).emit('message', `${playerName} ran out of time. They are out of the game.`);
        }, 60000); // 60000 мс = 1 хвилина
    }
});


server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
