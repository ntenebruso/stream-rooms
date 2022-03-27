const config = require("../config");

class Room {
    constructor(roomId, worker, io) {
        this.id = roomId;
        this.io = io;

        worker
            .createRouter({ mediaCodecs: config.mediasoup.mediaCodecs })
            .then((router) => {
                this.router = router;
            });

        this.peers = new Map();
    }

    async addPeer(peer) {
        this.peers.set(peer.id, peer);
    }

    getProducerList() {
        const producerList = {};
        console.log(producerList);
        this.peers.forEach((peer) => {
            if (peer.producers.size > 0) {
                producerList[peer.id] = [];
                peer.producers.forEach((producer) => {
                    producerList[peer.id].push(producer.id);
                });
            }
        });
        console.log(producerList);
        return producerList;
    }

    async createTransport(socketId) {
        const webRtcTransportOptions = {
            listenIps: [
                {
                    ip: "0.0.0.0", // replace with relevant IP address
                    announcedIp: "127.0.0.1",
                },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        };

        const transport = await this.router.createWebRtcTransport(
            webRtcTransportOptions
        );
        this.peers.get(socketId).addTransport(transport);

        return {
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
        };
    }

    async connectPeerTransport(socketId, transportId, dtlsParameters) {
        await this.peers
            .get(socketId)
            .connectTransport(transportId, dtlsParameters);
    }

    async produce(socketId, producerTransportId, parameters) {
        const producer = await this.peers
            .get(socketId)
            .createProducer(producerTransportId, parameters);
        return producer;
    }

    async consume(
        socketId,
        consumerTransportId,
        producerId,
        devRtpCapabilities
    ) {
        if (
            this.router.canConsume({
                producerId: producerId,
                rtpCapabilities: devRtpCapabilities,
            })
        ) {
            const { consumer, params } = await this.peers
                .get(socketId)
                .createConsumer(
                    consumerTransportId,
                    producerId,
                    devRtpCapabilities
                );

            consumer.on("producerclose", () => {
                console.log(
                    "Consumer closed due to producerclose event",
                    socketId
                );
                this.io.to(socketId).emit("consumer-close", consumer.id);
                this.peers.get(socketId).removeConsumer(consumer.id);
            });

            return { consumer, params };
        }
    }

    resumeConsumer(socketId, consumerId) {
        this.peers.get(socketId).resumeConsumer(consumerId);
    }

    closeProducer(socketId, producerId) {
        this.peers.get(socketId).closeProducer(producerId);
    }

    removePeer(socketId) {
        this.peers.get(socketId).close();
        this.peers.delete(socketId);
    }
}

module.exports = Room;
