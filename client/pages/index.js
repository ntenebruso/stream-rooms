import { useEffect, useState } from "react";
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
        });
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
        producer = await producerTransport.produce({ track: videoTrack });

        producer.on("trackended", () => {
            socket.emit("producer-closed", producer.id);
        });

        producer.on("transportclose", () => {
            socket.emit("producer-closed", producer.id);
        });
    }

    async function receiveStream() {
        await socket.emit("create-transport", async (params) => {
            consumerTransport = await device.createRecvTransport(params);

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

            await socket.emit("get-producers", async (producer) => {
                if (!producer) {
                    return alert("Not streaming yet");
                }

                const producerId = producer.producer_id;

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

                        const recvVideo =
                            document.getElementById("receive-video");
                        recvVideo.srcObject = new MediaStream([track]);
                    }
                );
            });
        });
    }

    return (
        <div>
            <h1>StreamRooms</h1>
            <video id="send-video" width="600" height="300" autoPlay></video>
            <button onClick={startStream}>Start stream</button>
            <video id="receive-video" autoPlay></video>
            <button onClick={receiveStream}>Receive rtc video</button>
        </div>
    );
}