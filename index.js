
function createTableRow() {
    const row = document.createElement("tr");
    for (var i = 0; i < arguments.length; i++) {
        const cell = document.createElement("th");
        cell.textContent = arguments[i];
        row.appendChild(cell);
    }
    return row;
}

function fetchPlayerData() {
    const mode = document.getElementById("mode-filter").value;
    const name = document.getElementById("name-filter").value;
    const lobby = document.getElementById("lobby-filter").value;
    const limit = document.getElementById("max-players").value;
    const search = mode + "," + name + "," + lobby + "," + limit;
    const table = document.getElementById("player-table");
    table.replaceChildren();
    fetch(`/api/players?search=${encodeURIComponent(search)}`, {
        method: "GET",
        credentials: "include"}).then(res => res.json()).then(data => {
            table.appendChild(createTableRow("", "Player", "OS"));
            for (var i = 0; i < data.players.length; i++) {
                table.appendChild(createTableRow(
                    i + 1,
                    data.players[i].name,
                    data.players[i].os /*+ " \u00B1" + data.players[i].uncertainty*/
                ));
            }
        });
}

document.getElementById("fetch-players").onclick = fetchPlayerData;
fetchPlayerData();

