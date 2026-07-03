#!/bin/sh
# Generate mediamtx.yml at runtime from env, then exec mediamtx.
# Camera credentials come from env ONLY — they are never baked into the image
# or committed. The generated config lives in /tmp inside the container and is
# not printed (it contains the RTSP password).
set -eu

RTSP_PORT=8554
HLS_PORT=8888
CONFIG=/tmp/mediamtx.yml

# Dahua sub stream (subtype=1) — smaller, enough for web live view.
cam_source() { # $1=ip $2=user $3=pass
  printf 'rtsp://%s:%s@%s:554/cam/realmonitor?channel=1&subtype=1' "$2" "$3" "$1"
}

cat > "$CONFIG" <<EOF
logLevel: info
rtsp: yes
rtspAddress: :${RTSP_PORT}
hls: yes
hlsAddress: :${HLS_PORT}
hlsVariant: mpegts
hlsAllowOrigin: '*'
paths:
EOF

add_path() { # $1=gate $2=ip $3=user $4=pass $5=transcode
  gate="$1"
  src="$(cam_source "$2" "$3" "$4")"
  if [ "${5:-0}" = "1" ]; then
    # H.265/HEVC camera → transcode to H.264 on demand (browsers can't play
    # HEVC over HLS). ffmpeg pulls the camera and republishes to this path.
    cat >> "$CONFIG" <<EOF
  ${gate}:
    runOnDemand: 'ffmpeg -rtsp_transport tcp -i "${src}" -c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -pix_fmt yuv420p -g 50 -an -f rtsp -rtsp_transport tcp rtsp://localhost:${RTSP_PORT}/${gate}'
    runOnDemandRestart: yes
    runOnDemandCloseAfter: 15s
EOF
  else
    # H.264 camera → pull the RTSP source directly, on demand.
    cat >> "$CONFIG" <<EOF
  ${gate}:
    source: "${src}"
    sourceOnDemand: yes
EOF
  fi
}

add_path left  "${CAM_LEFT_IP}"  "${CAM_LEFT_USER}"  "${CAM_LEFT_PASS}"  "${CAM_LEFT_TRANSCODE:-0}"
add_path right "${CAM_RIGHT_IP}" "${CAM_RIGHT_USER}" "${CAM_RIGHT_PASS}" "${CAM_RIGHT_TRANSCODE:-0}"

echo "[mediamtx-entrypoint] config generated (paths: left, right; left transcode=${CAM_LEFT_TRANSCODE:-0}, right transcode=${CAM_RIGHT_TRANSCODE:-0})"
exec mediamtx "$CONFIG"
