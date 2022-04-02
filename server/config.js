module.exports = {
    mediasoup: {
        mediaCodecs: [
            {
                kind: "video",
                mimeType: "video/VP8",
                clockRate: 90000,
            },
            {
                kind: "audio",
                mimeType: "audio/opus",
                clockRate: 48000,
                channels: 2,
            },
        ],
    },
};
