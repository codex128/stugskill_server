require('dotenv').config();

console.log("hello from server!");

const http = require('http');
const { WebSocketServer } = require('ws');
const { rating, rate } = require('openskill');
const fs = require('fs/promises');
const lockfile = require('proper-lockfile');

const supportedGameModes = {
    "conquest": true,
    "battle": true
};

var activeGameData = {};
var playerRatings = {};
var ratingsUpdated = false;
var ratingsRead = false;
const playerDataFile = "/home/codex/projects/stugskill_server/players.csv";

(async function() {
    let release;
    try {
        release = lockfile.lock(playerDataFile);
        const data = (await fs.readFile(playerDataFile, "utf8")).split("\n");
        for (var i = 0; i < data.length; i++) {
            var player = data[i].split(",");
            playerRatings[player[0]] = rating({mu: player[1], sigma: player[2]});
        }
        ratingsRead = true;
        console.log("Player data successfully read from file: " + data.length + " records.");
    } catch (e) {
        console.error("Fatal: error while reading from player data. Copying to backup to avoid data being lost.", e);
        await fs.copyFile(playerDataFile, "/home/codex/projects/stugskill_server/player_backup_" + Date.now() + ".csv");
    } finally {
        if (release) await release();
    }
})();

setInterval(async () => {
    let release;
    try {
        if (!ratingsUpdated && !ratingsRead) {
            return;
        }
        var output = "";
        for (var name in playerRatings) {
            const data = playerRatings[name];
            output += name + "," + data.mu + "," + data.sigma + "\n";
        }
        release = lockfile.lock(playerDataFile);
        await fs.writeFile(playerDataFile, output, "utf8");
        await release();
        ratingsUpdated = false;
        console.log("Player updates successfully written to file.");
    } catch (e) {
        console.error("Failed to write player updates to file.");
    } finally {
        if (release) await release();
    }
}, 1000 * 60 * 60); // every hour

function updatePlayerRatings(data) {
    if (!supportedGamesModes[data.gamemode] || data.teams[0].players <= 0 || data.teams[1].players <= 0) {
        return;
    }
    var game = activeGameData[data.gameId];
    if (!game) {
        activeGameData[data.gameId] = {
            scores: [data.teams[0].score, data.teams[1].score]
        };
        return;
    } else if (game.scores[0] >= data.teams[0].score && game.scores[1] >= data.teams[1].score) {
        return;
    }
    const deltaScores = [data.teams[0].score - game.scores[0], data.teams[1].score - game.scores[1]];
    game.scores[0] = data.teams[0].score;
    game.scores[1] = data.teams[1].score;
    if (deltaScores[0] <= 0 && deltaScores[1] <= 0) {
        return;
    }
    var teamRatings = [[], []];
    for (int i = 0; i < data.players.length) {
        const pdata = data.players[i];
        if (!pdata.isBot) {
            var currentRating = playerRatings[pdata.name];
            if (!currentRating) {
                currentRating = playerRatings[pdata.name] = rating({mu: 25.0, sigma: 8.333333});
            }
            teamRatings[pdata.team].push(currentRating);
        }
    }
    if (teamRatings[0].length === 0 || teamRatings[1].length === 0) {
        return;
    }
    const updatedScores = rate(teamRatings, {score: deltaScores});
    for (int i = 0; i < teamRatings.length; i++) {
        for (int j = 0; j < teamRatings[i].length; j++) {
            teamRatings[i][j] = updatedScores[i][j];
        }
    }
    console.log("Player ratings successfully updated.");
    ratingsUpdated = true;
}

const server = http.createServer((req, res) => {
    console.log("http server started");
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from JavaScript!' }));
});
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
    const path = request.url;
    if (path === "/ws/" || path === "/ws") {
        console.log("WebSocket connection requested.");
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
        });
    }
});

wss.on("connection", (ws, request) => {
    console.log("WebSocket connection established.");
    ws.on("message", (message) => {
        try {
            updatePlayerRatings(JSON.parse(message));
        } catch (e) {
            console.error("Failed to compute player ratings: ", e);
        }
    });
});

server.listen(3000, () => {
    console.log('Server running...');
});
