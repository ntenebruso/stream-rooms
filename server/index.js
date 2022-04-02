const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ["http://localhost:3000"],
    },
});

const PORT = process.env.PORT || 5000;

// CORS
const cors = require("cors");
app.use(cors());

const mediasoup = require("mediasoup");

const Room = require("./utils/Room");
const Peer = require("./utils/Peer");

(async () => {
    await runMediasoupWorker();
    await runSocketServer();
})();

async function runMediasoupWorker() {
    worker = await mediasoup.createWorker();
}

async function runSocketServer() {
    const room = new Room("Test_Room", worker, io.of("/media"));
    io.of("/media").on("connection", async (socket) => {
        const peer = new Peer(socket.id, "Test_User");
        room.addPeer(peer);
        socket.on("rtp-capabilities", (callback) => {
            callback(room.router.rtpCapabilities);
        });

        socket.on("create-transport", async (callback) => {
            const { params } = await room.createTransport(socket.id);
            callback(params);
        });

        socket.on(
            "transport-connect",
            async ({ transportId, dtlsParameters }) => {
                await room.connectPeerTransport(
                    socket.id,
                    transportId,
                    dtlsParameters
                );
            }
        );

        socket.on("produce", async (parameters, callback) => {
            const producer = await room.produce(
                socket.id,
                parameters.transportId,
                parameters
            );
            socket.broadcast.emit("new-producer", producer.id);
            await callback(producer.id);
        });

        socket.on("get-producers", async (callback) => {
            const producers = room.getProducerList();
            callback(producers);
        });

        socket.on(
            "consume",
            async (
                { consumerTransportId, producerId, devRtpCapabilities },
                callback
            ) => {
                const { consumer, params } = await room.consume(
                    socket.id,
                    consumerTransportId,
                    producerId,
                    devRtpCapabilities
                );
                callback(params);
            }
        );

        socket.on("resume-consumer", async (consumerId) => {
            room.resumeConsumer(socket.id, consumerId);
        });

        socket.on("producer-closed", (producerId) => {
            console.log("Producer closed");
            room.closeProducer(socket.id, producerId);
        });

        socket.on("disconnect", () => {
            console.log("Peer disconnected");
            room.removePeer(socket.id);
        });
    });
}

httpServer.listen(PORT, () => {
    console.log("Listening on port " + PORT);
});
