import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { L } from '../labels.js';

// One camera tile. Plays an HLS stream; on any failure (no URL yet, network,
// decode) it falls back to an "offline" placeholder so a dead camera never
// takes down the page.
export default function CameraView({ name, hlsUrl }) {
  const videoRef = useRef(null);
  const [offline, setOffline] = useState(!hlsUrl);

  useEffect(() => {
    const video = videoRef.current;
    if (!hlsUrl || !video) {
      setOffline(true);
      return undefined;
    }
    setOffline(false);

    let hls;
    if (Hls.isSupported()) {
      hls = new Hls({ liveDurationInfinity: true });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        // Only fatal errors mean the stream is truly unplayable.
        if (data.fatal) setOffline(true);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari / iOS play HLS natively — point src straight at the playlist.
      video.src = hlsUrl;
      video.addEventListener('error', () => setOffline(true));
    } else {
      setOffline(true);
    }

    // Cleanup: destroy the hls.js instance so buffers/workers don't leak when
    // the tile unmounts or the URL changes.
    return () => {
      if (hls) hls.destroy();
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [hlsUrl]);

  return (
    <div className="camera">
      <span className="camera-label">
        <span className="dot" />
        {name}
      </span>
      {offline ? (
        <div className="camera-offline">
          <span className="glyph">📷</span>
          {L.cameraOffline}
        </div>
      ) : (
        <video
          ref={videoRef}
          className="camera-media"
          autoPlay
          muted
          playsInline
        />
      )}
    </div>
  );
}
