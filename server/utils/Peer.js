class Peer {
    constructor(socketId, name) {
        this.id = socketId;
        this.transports = new Map();
        this.consumers = new Map();
        this.producers = new Map();
    }

    addTransport(transport) {
        this.transports.set(transport.id, transport);
    }

    async connectTransport(transportId, dtlsParameters) {
        await this.transports.get(transportId).connect({ dtlsParameters });
    }

    async createProducer(producerTransportId, parameters) {
        const producer = await this.transports
            .get(producerTransportId)
            .produce({ ...parameters });

        this.producers.set(producer.id, producer);
        return producer;
    }

    async createConsumer(consumerTransportId, producerId, devRtpCapabilities) {
        const consumerTransport = this.transports.get(consumerTransportId);

        const consumer = await consumerTransport.consume({
            producerId: producerId,
            rtpCapabilities: devRtpCapabilities,
            paused: true,
        });

        this.consumers.set(consumer.id, consumer);

        const params = {
            id: consumer.id,
            producerId: producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
        };

        return {
            consumer,
            params,
        };
    }

    removeConsumer(consumerId) {
        this.consumers.delete(consumerId);
    }

    closeProducer(producerId) {
        this.producers.get(producerId).close();
        this.producers.delete(producerId);
        console.log("deleted");
    }

    close() {
        this.transports.forEach((transport) => transport.close());
    }
}

module.exports = Peer;
