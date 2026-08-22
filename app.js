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
const cleaningInterval = 1000 * 60 * 5;   // hour
const staleGameThreshold = 1000 * 60 * 15; // 15 minutes

(async function() {
    let release;
    try {
        release = await lockfile.lock(playerDataFile);
        const data = (await fs.readFile(playerDataFile, "utf8")).split("\n");
        var records = 0;
        for (var i = 0; i < data.length; i++) {
            var player = data[i].split(",");
            if (player.length >= 3) {
                playerRatings[player[0]] = rating({mu: parseFloat(player[1]), sigma: parseFloat(player[2])});
                records++;
            }
        }
        ratingsRead = true;
        console.log("Player data successfully read from file: " + records + " records.");
    } catch (e) {
        console.error("Fatal: error while reading from player data. Copying to backup to avoid data being lost.", e);
        await fs.copyFile(playerDataFile, "/home/codex/projects/stugskill_server/player_backup_" + Date.now() + ".csv");
    } finally {
        if (typeof release === "function") {
            await release();
            console.log("Player file released.");
        }
    }
})();

setInterval(async () => {
    let release;
    try {
        if (!ratingsUpdated && !ratingsRead) {
            return;
        }
        var output = "";
        var records = 0;
        for (var name in playerRatings) {
            const data = playerRatings[name];
            output += name + "," + data.mu + "," + data.sigma + "\n";
            records++;
        }
        release = await lockfile.lock(playerDataFile);
        await fs.writeFile(playerDataFile, output, "utf8");
        ratingsUpdated = false;
        console.log("Player updates successfully written to file: " + records + " records.");
    } catch (e) {
        console.error("Failed to write player updates to file: ", e);
    } finally {
        if (typeof release === "function") {
            await release();
            console.log("Player file released.");
        }
    }
    try {
        const now = Date.now();
        Object.keys(activeGameData).forEach(key => {
            if (activeGameData[key].lastUpdate + staleGameThreshold < now) {
                delete activeGameData[key];
            }
        });
    } catch (e) {
        console.error("Failed to clean game data:", e);
    }
}, cleaningInterval);

function updatePlayerRatings(data) {
    if (!supportedGameModes[data.gamemode] || data.teams[0].players <= 0 || data.teams[1].players <= 0) {
        return;
    }
    var game = activeGameData[data.shareLinkToken];
    if (!game) {
        activeGameData[data.shareLinkToken] = {
            lastUpdate: Date.now(),
            scores: [data.teams[0].score, data.teams[1].score]
        };
        console.log("rejected: game not initialized");
        return;
    }
    const deltaScores = [data.teams[0].score - game.scores[0], data.teams[1].score - game.scores[1]];
    game.scores[0] = data.teams[0].score;
    game.scores[1] = data.teams[1].score;
    game.lastUpdate = Date.now();
    if (deltaScores[0] <= 0 && deltaScores[1] <= 0) {
        console.log("rejected: non-positive team scores");
        return;
    }
    var teamRatings = [[], []];
    for (var i = 0; i < data.players.length; i++) {
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
        console.log("rejected: team has zero real players.");
        return;
    }
    console.log(teamRatings);
    const updatedScores = rate(teamRatings, {score: deltaScores});
    console.log(updatedScores);
    for (var i = 0; i < teamRatings.length; i++) {
        for (var j = 0; j < teamRatings[i].length; j++) {
            teamRatings[i][j].mu = updatedScores[i][j].mu;
            teamRatings[i][j].sigma = updatedScores[i][j].sigma;
        }
    }
    console.log("Player ratings successfully updated.");
    ratingsUpdated = true;
}

const server = http.createServer((req, res) => {});
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
    ws.on("close", (code, reason) => {
        console.log(`WebSocket disconnected (code: ${code}, reason: ${reason.toString() || "unknown"})`)
    });
});

server.listen(3000, () => {
    console.log('Server running...');
});
