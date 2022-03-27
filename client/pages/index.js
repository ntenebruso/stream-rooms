import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";

export default function Home() {
    const [socket, setSocket] = useState();

    let rtpCapabilities,
        device,
        videoStream,
        producerTransport,
        producer,
        consumerTransport,
        consumer;

    const streamsContainer = useRef(null);

    useEffect(() => {
        const socketInstance = io("ws://localhost:5000/media");
        setSocket(socketInstance);
    }, []);

    useEffect(() => {
        if (!socket) return;

        socket.emit("rtp-capabilities", (capabilities) => {
            rtpCapabilities = capabilities;
            console.log("RTP Capabilities:", rtpCapabilities);
            device = new Device();
            device.load({ routerRtpCapabilities: rtpCapabilities });
            receiveStreams();
        });

        socket.on("consumer-close", (consumerId) => {
            console.log(
                "consumer closed due to producerclose event",
                consumerId
            );
            streamsContainer.current.childNodes.forEach((child) => {
                if (child.dataset.consumerId == consumerId) {
                    child.remove();
                }
            });
        });

        socket.on("new-producer", async () => {
            console.log("receiving stream");
            await receiveStreams();
        });

        return () => {
            socket.off("new-producer");
        };
    }, [socket]);

    async function startStream() {
        socket.emit("create-transport", (params) => {
            producerTransport = device.createSendTransport(params);
            console.log("Producer transport created:", params);

            producerTransport.on(
                "connect",
                async ({ dtlsParameters }, callback) => {
                    await socket.emit("transport-connect", {
                        transportId: producerTransport.id,
                        dtlsParameters,
                    });
                    callback();
                    console.log(
                        "Producer transport connected. DTLS parameters: ",
                        dtlsParameters
                    );
                }
            );

            producerTransport.on("produce", async (parameters, callback) => {
                await socket.emit(
                    "produce",
                    {
                        transportId: producerTransport.id,
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    },
                    (id) => {
                        callback({ id });
                    }
                );
            });
        });

        const sendVideo = document.getElementById("send-video");
        videoStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true,
        });
        sendVideo.srcObject = videoStream;

        const videoTrack = videoStream.getVideoTracks()[0];

        producer = await producerTransport.produce({
            track: videoTrack,
            codecOptions: {
                videoGoogleStartBitrate: 1000,
            },
        });

        producer.on("trackended", () => {
            console.log("trackended");
            socket.emit("producer-closed", producer.id);
        });

        producer.on("transportclose", () => {
            console.log("producer closed");
            socket.emit("producer-closed", producer.id);
            videoStream.srcObject.getTracks().forEach((track) => track.stop());
        });
    }

    async function receiveStreams() {
        while (streamsContainer.current.firstChild) {
            streamsContainer.current.removeChild(
                streamsContainer.current.firstChild
            );
            console.log("REMOVE");
        }

        await socket.emit("create-transport", async (params) => {
            consumerTransport = await device.createRecvTransport(params);
            console.log("Consumer transport created:", params);

            consumerTransport.on(
                "connect",
                async ({ dtlsParameters }, callback) => {
                    await socket.emit("transport-connect", {
                        transportId: consumerTransport.id,
                        dtlsParameters,
                    });

                    callback();
                    console.log(
                        "Consumer transport connected. DTLS parameters: ",
                        dtlsParameters
                    );
                }
            );

            await socket.emit("get-producers", async (producerPeers) => {
                if (Object.keys(producerPeers).length == 0) {
                    return console.log("Stream has not started");
                }
                console.log("producer peers", producerPeers);
                Object.values(producerPeers).forEach(async (producerPeer) => {
                    for (var i = 0; i < producerPeer.length; i++) {
                        const producerId = producerPeer[i];
                        console.log("producer id", producerId);
                        await socket.emit(
                            "consume",
                            {
                                consumerTransportId: consumerTransport.id,
                                producerId: producerId,
                                devRtpCapabilities: device.rtpCapabilities,
                            },
                            async (params) => {
                                if (params.error) {
                                    return console.error("Cannot consume");
                                }

                                consumer = await consumerTransport.consume({
                                    id: params.id,
                                    producerId: params.producerId,
                                    kind: params.kind,
                                    rtpParameters: params.rtpParameters,
                                });

                                const { track } = consumer;

                                await socket.emit(
                                    "resume-consumer",
                                    consumer.id
                                );

                                console.log("track", track);
                                if (track.kind == "video") {
                                    const recvVideo =
                                        document.createElement("video");
                                    streamsContainer.current.append(recvVideo);
                                    recvVideo.dataset.consumerId = consumer.id;
                                    recvVideo.srcObject = new MediaStream([
                                        track,
                                    ]);
                                    recvVideo.muted = true;
                                    recvVideo.play();
                                }
                            }
                        );
                    }
                });
            });
        });
    }

    async function stopStream() {
        producerTransport.close();
    }

    return (
        <div>
            <h1>StreamRooms</h1>
            <video id="send-video" width="600" height="300" autoPlay></video>
            <button onClick={startStream}>Start stream</button>
            <button onClick={stopStream}>Stop stream</button>
            <button onClick={receiveStreams}>receive streams</button>
            <div id="streams" ref={streamsContainer}></div>
        </div>
    );
}
