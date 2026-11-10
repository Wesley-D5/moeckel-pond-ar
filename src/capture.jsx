import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Dialog} from './dialog.jsx';
import {Icon} from './icons.jsx';

// XR8 draws the camera first and Three.js draws the artwork on top of it.
// A final pipeline module snapshots that frame before the browser clears the WebGL buffer.
function captureFrame(engine, canvas, isLocked, signal) {
  return new Promise((resolve, reject) => {
    const name = 'pond-photo';
    let drawn = false, finished = false, attached = false;
    const finish = (blob, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (attached) {
        // XR8 may already have cleared its modules while closing the session.
        try { engine.removeCameraPipelineModule(name); } catch {}
      }
      if (blob) resolve(blob);
      else reject(error || new Error('The photo could not be captured. Please try again.'));
    };
    const cancel = () => finish(null, new DOMException('Capture canceled.', 'AbortError'));
    const timeout = setTimeout(() => finish(null), 3500);
    signal.addEventListener('abort', cancel, {once:true});
    if (signal.aborted) { cancel(); return; }
    try {
      engine.addCameraPipelineModule({
        name,
        onRender() {
          if (drawn || finished) return;
          drawn = true;
          if (!isLocked()) {
            queueMicrotask(() => finish(null, new Error('Bring the artwork back into view and try again.')));
            return;
          }
          try {
            canvas.toBlob(blob => finish(blob), 'image/jpeg', 0.92);
          } catch (error) { queueMicrotask(() => finish(null, error)); }
        }
      });
      attached = true;
    } catch (error) { finish(null, error); }
  });
}

export function CameraCapture({canvasRef, locked, onReview, onRetake, onDismiss}) {
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const liveLock = useRef(locked);
  liveLock.current = locked;
  const pending = useRef(null), imageUrl = useRef(null);

  useEffect(() => () => {
    pending.current?.abort();
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
  }, []);

  async function take() {
    if (pending.current || !liveLock.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError('');
    try {
      const blob = await captureFrame(window.XR8, canvasRef.current, () => liveLock.current, request.signal);
      if (request.signal.aborted) return;
      const name = 'Moeckel-Pond-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jpg';
      const url = URL.createObjectURL(blob);
      imageUrl.current = url;
      const file = typeof File === 'function' ? new File([blob], name, {type:blob.type}) : null;
      let shareable = false;
      try { shareable = !!(file && navigator.share && navigator.canShare?.({files:[file]})); } catch {}
      setPhoto({url, name, file, shareable});
      onReview();
    } catch (failure) {
      if (!request.signal.aborted) setError(failure.message || 'Please try taking the photo again.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  async function share() {
    try { await navigator.share({files:[photo.file]}); }
    catch (failure) {
      if (failure.name !== 'AbortError') setError('Sharing is unavailable. You can download the photo.');
    }
  }

  const engine = window.XR8;
  const supported = engine?.addCameraPipelineModule && engine.removeCameraPipelineModule &&
    typeof canvasRef.current?.toBlob === 'function' && typeof URL.createObjectURL === 'function';
  if (!photo && !supported) return null;
  return <>
    <link rel="stylesheet" href="./capture.css" precedence="default"/>
    {locked && !photo && <button className="glass-icon photo-shutter" aria-label="Take a photo" title="Take a photo" onClick={take} disabled={busy}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7.5h4l1.5-2h7l1.5 2h4v12H3z" strokeLinejoin="round"/><circle cx="12" cy="13.1" r="3.4"/></svg>
    </button>}
    {!photo && error && <span role="status" className="photo-error">{error}</span>}
    {photo && createPortal(<Dialog title="Your photo" kind="photo-review" close={onDismiss}>
      <h2>Your photo</h2>
      <img className="photo-preview" src={photo.url} alt="Your photo of Moeckel Pond in augmented reality"/>
      <div className="photo-actions">
        {photo.shareable && <button className="solid" onClick={share}><Icon name="share" size={16}/>Share photo</button>}
        <a className={photo.shareable?'photo-secondary':'solid'} href={photo.url} download={photo.name}>Download photo</a>
      </div>
      {error && <p role="status" className="tip">{error}</p>}
      <button className="quiet" onClick={onRetake}><Icon name="reset" size={14}/>Retake photo</button>
    </Dialog>, document.body)}
  </>;
}
