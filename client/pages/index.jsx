import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { Device } from "mediasoup-client";

export default function Home() {
    const [socket, setSocket] = useState();

    let rtpCapabilities,
        device,
        mediaStream,
        producerTransport,
        videoProducer,
        audioProducer,
        consumerTransport,
        consumer,
        producerIds = [],
        streaming = false;

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
            createConsumerTransport();
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

        socket.on("new-producer", async (producerId) => {
            console.log("receiving stream");
            await receiveStream(producerId);
        });

        return () => {
            socket.off("new-producer");
        };
    }, [socket]);

    async function startStream() {
        if (!streaming) {
            socket.emit("create-transport", (params) => {
                producerTransport = device.createSendTransport(params);
                console.log("Producer transport created:", params);

                streaming = true;

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

                producerTransport.on(
                    "produce",
                    async (parameters, callback) => {
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
                    }
                );
            });

            const sendVideo = document.getElementById("send-video");
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: true,
            });

            const videoTrack = mediaStream.getVideoTracks()[0];
            const audioTrack = mediaStream.getAudioTracks()[0];

            if (videoTrack) {
                sendVideo.srcObject = new MediaStream([videoTrack]);

                videoProducer = await producerTransport.produce({
                    track: videoTrack,
                    codecOptions: {
                        videoGoogleStartBitrate: 1000,
                    },
                });

                producerIds.push(videoProducer.id);

                videoProducer.on("trackended", () => {
                    console.log("trackended");
                    socket.emit("producer-closed", videoProducer.id);
                });

                videoProducer.on("transportclose", () => {
                    console.log("producer closed");
                    socket.emit("producer-closed", videoProducer.id);
                    mediaStream.getTracks().forEach((track) => track.stop());
                });
            }

            if (audioTrack) {
                audioProducer = await producerTransport.produce({
                    track: audioTrack,
                });

                producerIds.push(audioProducer.id);

                audioProducer.on("trackended", () => {
                    console.log("trackended");
                    socket.emit("producer-closed", audioProducer.id);
                });

                audioProducer.on("transportclose", () => {
                    console.log("producer closed");
                    socket.emit("producer-closed", audioProducer.id);
                    mediaStream.getTracks().forEach((track) => track.stop());
                });
            }
        }
    }

    async function createConsumerTransport() {
        await socket.emit("create-transport", async (params) => {
            consumerTransport = await device.createRecvTransport(params);
            console.log("Consumer transport created:", params);
            await receiveAllStreams();
            consumerTransport.on(
                "connect",
                async ({ dtlsParameters }, callback) => {
                    await socket.emit("transport-connect", {
                        transportId: consumerTransport.id,
                        dtlsParameters,
                    });

                    await callback();
                    console.log(
                        "Consumer transport connected. DTLS parameters: ",
                        dtlsParameters
                    );
                }
            );
        });
    }

    async function receiveAllStreams() {
        await socket.emit("get-producers", async (producerPeers) => {
            console.log("producer peers", producerPeers);
            if (Object.keys(producerPeers).length == 0) {
                return console.log("Stream has not started");
            }

            Object.values(producerPeers).forEach(async (producerPeer) => {
                for (var i = 0; i < producerPeer.length; i++) {
                    const producerId = producerPeer[i];
                    await receiveStream(producerId);
                }
            });
        });
    }

    async function receiveStream(producerId) {
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

                await socket.emit("resume-consumer", consumer.id);

                console.log("track", track);
                if (track.kind == "video") {
                    const recvVideo = document.createElement("video");
                    streamsContainer.current.append(recvVideo);
                    recvVideo.dataset.consumerId = consumer.id;
                    recvVideo.srcObject = new MediaStream([track]);
                    recvVideo.muted = true;
                    recvVideo.play();
                } else if (track.kind == "audio") {
                    const recvAudio = document.createElement("audio");
                    streamsContainer.current.append(recvAudio);
                    recvAudio.dataset.consumerId = consumer.id;
                    recvAudio.srcObject = new MediaStream([track]);
                    recvAudio.play();
                }
            }
        );
    }

    async function stopStream() {
        producerTransport.close();
        streaming = false;
    }

    return (
        <div>
            <h1>StreamRooms</h1>
            <video
                id="send-video"
                width="600"
                height="300"
                autoPlay
                style={{ transform: "scaleX(-1)" }}
            ></video>
            <button onClick={startStream}>Start stream</button>
            <button onClick={stopStream}>Stop stream</button>
            {/* <button onClick={receiveStreams}>receive streams</button> */}
            <div id="streams" ref={streamsContainer}></div>
        </div>
    );
}
