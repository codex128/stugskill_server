require('dotenv').config();

console.log("hello from server!");

const http = require('http');
const { WebSocketServer } = require('ws');
const { rating, rate, ordinal } = require('openskill');
const fs = require('fs/promises');
const lockfile = require('proper-lockfile');

const supportedGameModes = {
    "conquest": true,
    "battle": true
};

var activeGameData = {};
var playerRatings = {
    conquest: {},
    battle: {},
    "1v1": {}
};
var ratingsUpdated = false;
var ratingsRead = false;
const playerDataFile = "/home/codex/projects/stugskill_server/players.csv";
const cleaningInterval = 1000 * 60 * 15;   // 15 minutes
const staleGameThreshold = 1000 * 60 * 15; // 15 minutes
const playerSkillDecay = [1000 * 60 * 60 * 24 * 3, 1000 * 60 * 60 * 24 * 30]; // 3 days, 30 days

(async function() {
    let release;
    try {
        release = await lockfile.lock(playerDataFile);
        const now = Date.now();
        const data = (await fs.readFile(playerDataFile, "utf8")).split("\n");
        var records = 0;
        for (var i = 0; i < data.length; i++) {
            var player = data[i].split(",");
            if (player.length >= 4) {
                var mode = playerRatings[player[0]];
                if (mode) {
                    mode[player[1]] = {
                        mu: parseFloat(player[2]),
                        sigma: parseFloat(player[3]),
                        lastSeen: (players.length >= 5 ? parseInt(players[4]) : Date.now())
                    };
                    records++;
                } else {
                    console.warn("Player data references unsupported game mode: " + data[i]);
                }
            }
        }
        ratingsRead = true;
        console.log("Player data successfully read from file: " + records + " records in " + (Date.now() - now) + "ms.");
    } catch (e) {
        console.error("Fatal: error while reading from player data. Copying to backup to avoid data being lost.", e);
        await fs.copyFile(playerDataFile, "/home/codex/projects/stugskill_server/player_backup_" + Date.now() + ".csv");
    } finally {
        if (typeof release === "function") {
            await release();
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
        const now = Date.now();
        for (var mode in playerRatings) {
            for (var name in playerRatings[mode]) {
                const data = playerRatings[mode][name];
                output += mode + "," + name + "," + data.mu + "," + data.sigma + "," + data.lastSeen + "\n";
                records++;
            }
        }
        release = await lockfile.lock(playerDataFile);
        await fs.writeFile(playerDataFile, output, "utf8");
        ratingsUpdated = false;
        console.log("Player updates successfully written to file: " + records + " records in " + (Date.now() - now) + "ms.");
    } catch (e) {
        console.error("Failed to write player updates to file: ", e);
    } finally {
        if (typeof release === "function") {
            await release();
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

function computeInitialRating(xp) {
    const rank = 0.035 * Math.sqrt(xp);
    return {mu: 25 + rank * (17 / 400), sigma: 8.3333 - rank * (5.3333 / 400)};
}

function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMin >= inMax) {
        return outMax;
    }
    return Math.min(Math.max((value - inMin) / (inMax - inMin), 0), 1) * (outMax - outMin) + outMin;
}

function updatePlayerRatings(data) {
    if (data.gamemode === "battle" && data.teams[0].players === 1 && data.teams[1].players === 1) {
        data.gamemode = "1v1";
    } else if (!playerRatings[data.gamemode] || data.teams[0].players <= 0 || data.teams[1].players <= 0) {
        console.log("rejecting: unsupported game mode or lacking players.");
        return;
    }
    var game = activeGameData[data.shareLinkToken];
    if (!game) {
        activeGameData[data.shareLinkToken] = {
            lastUpdate: Date.now(),
            scores: [data.teams[0].score, data.teams[1].score]
        }
        console.log("rejecting: must initialize game.");
        return;
    }
    const deltaScores = [data.teams[0].score - game.scores[0], data.teams[1].score - game.scores[1]];
    game.scores[0] = data.teams[0].score;
    game.scores[1] = data.teams[1].score;
    game.lastUpdate = Date.now();
    if (deltaScores[0] <= 0 && deltaScores[1] <= 0) {
        console.log("rejecting: no positive score difference");
        return;
    }
    var teamRatings = [[], []];
    var playerCount = 0;
    for (var i = 0; i < data.players.length; i++) {
        const pdata = data.players[i];
        if (pdata.team !== null && !pdata.isBot) {
            playerCount++;
            var currentRating = playerRatings[data.gamemode][pdata.name];
            if (!currentRating) {
                currentRating = playerRatings[data.gamemode][pdata.name] = computeInitialRating(pdata.xp);
            }
            const timeSinceLastSeen = game.lastUpdate - currentRating.lastSeen;
            if (timeSinceLastSeen > playerSkillDecay[0]) {
                currentRating.sigma = mapRange(timeSinceLastSeen, playerSkillDecay[0], playerSkillDecay[1], currentRating.sigma, 8.3333);
            }
            currentRating.lastSeen = game.lastUpdate;
            teamRatings[pdata.team].push(currentRating);
        }
    }
    if (teamRatings[0].length === 0 || teamRatings[1].length === 0) {
        console.log("rejecting: lacking real players (" + playerCount + ")");
        return;
    }
    // tau ensures players don't get locked down into a rating
    const updatedScores = rate(teamRatings, {score: deltaScores, tau: 0.083333, margin: 0.75});
    for (var i = 0; i < teamRatings.length; i++) {
        for (var j = 0; j < teamRatings[i].length; j++) {
            teamRatings[i][j].mu = updatedScores[i][j].mu;
            teamRatings[i][j].sigma = updatedScores[i][j].sigma;
        }
    }
    console.log("Player ratings successfully updated.");
    ratingsUpdated = true;
}

const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/players") {
        var searchTerms = url.searchParams.get("search").split(",");
        searchTerms[1] = searchTerms[1].toLowerCase();
        const mode = playerRatings[searchTerms[0]];
        var results = [];
        for (var name in mode) {
            if (name.toLowerCase().includes(searchTerms[1])) {
                results.push({name: name, os: Math.floor(ordinal(mode[name]) * 10) / 10});
            }
        }
        results.sort((a, b) => b.os - a.os);
        const limit = parseInt(searchTerms[2]);
        if (limit > 0) {
            results = results.slice(0, limit);
        }
        res.writeHead(200);
        res.end(JSON.stringify({players: results}));
    }
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
    ws.on("close", (code, reason) => {
        console.log(`WebSocket disconnected (code: ${code}, reason: ${reason.toString() || "unknown"})`)
    });
});

server.listen(3000, () => {
    console.log('Server running...');
});
