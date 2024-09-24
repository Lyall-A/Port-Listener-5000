const net = require("net");
const fs = require("fs");
const path = require("path");

const config = require("./config.json");

const servers = [];

const logsDirectory = config.logsDirectory ? path.resolve(__dirname, config.logsDirectory) : null;
if (logsDirectory && !fs.existsSync(logsDirectory)) fs.mkdirSync(logsDirectory); // TODO

for (let port = config.rangeStart; port <= config.rangeEnd; port++) {
    if (config.skipPorts.includes(port)) {
        info(null, `Skipping port: ${port}`);
        continue;
    };

    const serverInfo = {
        hasError: false,
        error: null,
        connectionCount: 0,
        activeConnectionCount: 0,
        uniqueConnectionCount: 0,
        connections: [],
        activeConnections: [],
        server: net.createServer(),
        port,
        date: new Date()
    }
    const { server } = serverInfo;

    server.on("error", err => {
        warn(err, `Server for port ${port} had an error!`);
        serverInfo.hasError = true;
        serverInfo.error = err;
    });

    server.on("close", () => {
        info(`Server for port ${port} has closed!`);
    });

    server.on("connection", async socket => {
        const ipInfo = await getIpInfo(socket);

        const connection = {
            socket,
            ipInfo,
            chunks: [],
            sent: [],
            closed: false,
            date: new Date(),
            timeout: setTimeout(() => socket.destroy(), config.connectionTimeout)
        };

        if (!serverInfo.connections.find(i => i.ipInfo.rawIp === ipInfo.rawIp)) serverInfo.uniqueConnectionCount++;
        serverInfo.connectionCount++;
        serverInfo.connections.push(connection);

        serverInfo.activeConnectionCount++;
        serverInfo.activeConnections.push(connection);

        if (config.connectionSend) {
            send(config.connectionSend);
        } else
        if (config.connectionReply) {
            socket.on("data", chunk => {
                connection.chunks.push(chunk);
                send(config.connectionReply);
            });
        }

        socket.on("close", () => {
            clearTimeout(connection.timeout);
            connection.closed = true;
            serverInfo.activeConnectionCount--;
            serverInfo.activeConnections.splice(serverInfo.activeConnections.findIndex(i => i.rawIp === ipInfo.rawIp), 1);
            log(connection, serverInfo); // temp
        });

        function send(msg) {
            socket.end(msg);
            connection.sent.push(msg);
        }
    });

    server.listen(port, () => log(`Server listening on port: ${port}`));

    servers.push(serverInfo);
}

function log(...msgs) {
    console.log("[LOG]", ...msgs);
}

function info(...msgs) {
    console.log("[INFO]", ...msgs);
}

function error(err, ...msgs) {
    console.log("[ERROR]", ...msgs);
    console.log(err);
}

function warn(err, ...msgs) {
    console.log("[WARNING]", ...msgs);
    if (err) console.log(err);
}

function getIpInfo(socket) {
    return new Promise(async resolve => {
        const ipInfo = {
            ip: socket.remoteAddress?.split("::ffff:")[1] || null,
            rawIp: socket.remoteAddress
        }

        if (config.getIpInfo && ipInfo.ip) {
            const geoInfo = await fetch(`http://ip-api.com/json/${ipInfo.ip}`).then(i => i.json()).catch(err => ipInfo.error = err);
            if (geoInfo.status === "success") {
                ipInfo.country = geoInfo.country;
                ipInfo.countryCode = geoInfo.countryCode;
                ipInfo.region = geoInfo.regionName;
                ipInfo.city = geoInfo.city;
                ipInfo.zip = geoInfo.zip;
                ipInfo.latitude = geoInfo.lat;
                ipInfo.longitude = geoInfo.lon;
                ipInfo.timezone = geoInfo.timezone;
                ipInfo.isp = geoInfo.isp;
            } else {
                ipInfo.error = geoInfo.message || true;
            }
        }

        resolve(ipInfo);
    });
}

function close() {
    info("Closing all servers...");
    servers.forEach(i => i.closed ? null : i.server.close());
}

process.on("SIGTERM", close); // Other stuff I guess
process.on("SIGINT", close); // CTRL + C