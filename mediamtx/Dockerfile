# MediaMTX + FFmpeg on Alpine so we have a shell (to generate config from env)
# and ffmpeg (to transcode H.265 cameras to browser-friendly H.264).
# The mediamtx binary is copied from the pinned official image.
FROM bluenviron/mediamtx:1.11.3 AS mtx

FROM alpine:3.20
# ffmpeg: HEVC decode + libx264 encode. No credentials in this layer.
RUN apk add --no-cache ffmpeg
COPY --from=mtx /mediamtx /usr/bin/mediamtx
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# HLS (browser) + RTSP (internal republish target for transcode).
EXPOSE 8888 8554
ENTRYPOINT ["/entrypoint.sh"]
