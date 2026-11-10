import React, {useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {startTracking} from './tracking.js';
import {startWebXR, supportsNativeWall} from './webxr.js';
import {film, printTarget} from '../content.js';
import {Icon} from './icons.jsx';
import {CameraCapture} from './capture.jsx';

export function useCamera() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(['loading', 'Opening the camera…']);
  const [failure, setFailure] = useState('');
  const [sound, setSound] = useState(false);
  const [native, setNative] = useState(false);
  const [width, setWidth] = useState(0.9);
  const host = useRef(null), canvas = useRef(null), video = useRef(null), controller = useRef(null);
  const serial = useRef(0), trigger = useRef(null), reviewingPhoto = useRef(false);
  useEffect(() => {
    let mounted = true;
    supportsNativeWall().then(supported => { if (mounted) setNative(supported); }).catch(() => {});
    return () => {
      mounted = false;
      ++serial.current;
      controller.current?.stop();
      controller.current = null;
      if (video.current) video.current.pause();
    };
  }, []);

  function close() {
    reviewingPhoto.current = false;
    ++serial.current;
    controller.current?.stop();
    controller.current = null;
    if (video.current) { video.current.pause(); video.current.removeAttribute('src'); video.current.load(); }
    setSession(null);
    const closedId = serial.current;
    requestAnimationFrame(() => {
      if (serial.current === closedId && trigger.current?.isConnected) trigger.current.focus();
    });
  }

  function launch(mode, preferNative, returnFocus) {
    reviewingPhoto.current = false;
    if (returnFocus) trigger.current = returnFocus;
    const id = ++serial.current;
    controller.current?.stop();
    controller.current = null;
    const isNative = mode === 'wall' && preferNative && native;
    flushSync(() => {
      setStatus(['loading', 'Opening the camera…']);
      setFailure(''); setWidth(0.9); setSound(false);
      setSession({id, mode, isNative});
    });
    const media = video.current;
    media.src = film;
    media.muted = true;
    media.load();
    function failed(error) {
      if (serial.current !== id) return;
      const denied = error?.name === 'NotAllowedError' || /permission.*denied|denied.*permission/i.test(error?.message || '');
      const missing = error?.name === 'NotFoundError' || /no camera|camera.*not found|requested device not found/i.test(error?.message || '');
      setFailure(denied ? 'Allow camera access in this site’s browser settings, then try again.' :
        missing ? 'Connect a camera, or open this artwork on your phone.' :
        error?.message || 'The camera could not start. Try opening this page in Safari or Chrome.');
    }
    try {
      const api = isNative ? startWebXR : startTracking;
      const active = api({mode, canvas:canvas.current, video:media, posterUrl:printTarget, overlayRoot:host.current,
        onStatus:(next, text) => {
          if (serial.current !== id) return;
          setStatus([next, text]);
          // A permission request can outlive the visible page. Close after the engine callback.
          if (!isNative && next !== 'loading' && document.hidden) {
            queueMicrotask(() => { if (serial.current === id && document.hidden) close(); });
          }
        },
        onError:failed, onEnd:() => { if (serial.current === id) close(); }});
      controller.current = active;
      active.setSize(0.9);
      active.ready.catch(failed);
      host.current.querySelector('button')?.focus();
    } catch (error) { failed(error); }
  }

  useEffect(() => {
    if (!session) return;
    const onKey = event => {
      if (reviewingPhoto.current) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !host.current) return;
      const controls = [...host.current.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden' && !reviewingPhoto.current && !session.isNative && status[0] !== 'loading') close(); };
    window.addEventListener('keydown', onKey); window.addEventListener('pagehide', close);
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', close); document.removeEventListener('visibilitychange', onHidden); };
  }, [session, status[0]]);

  function size(delta) {
    const next = Math.max(0.3, Math.min(2.4, Math.round((width+delta)*10)/10));
    setWidth(next); controller.current?.setSize(next);
  }

  function toggleSound() {
    const enabled = !sound;
    video.current.muted = !enabled;
    if (['tracking','placed'].includes(status[0])) video.current.play().catch(() => {});
    setSound(enabled);
  }

  const [state, message] = status;
  const locked = state === 'tracking' || state === 'placed';
  const scan = session?.mode === 'scan';
  const view = session && <div key={session.id} className={'camera' + (session.isNative?' native-camera':'')} role="dialog" aria-modal="true" aria-label={scan?'Print scanner':'Wall placement'} ref={host}>
    <canvas className="camera-surface" ref={canvas}/>
    <video className="camera-media" aria-hidden="true" ref={video} muted={!sound} playsInline loop preload="none"
      onVolumeChange={event => setSound(!event.currentTarget.muted)}/>
    <div className="camera-top"><span className="chip"><Icon name={scan?'scan':'cube'} size={17}/>{scan?'Print scanner':'Wall placement'}</span><button className="glass-icon" onClick={close} aria-label="Close camera"><Icon name="close"/></button></div>
    {failure ? <div className="camera-error"><div className="modal-emblem"><Icon name="scan" size={26}/></div><h2>Camera unavailable</h2><p role="alert">{failure}</p><button className="solid" onClick={() => launch(session.mode, false)}>{session.isNative?'Try 8th Wall':'Try again'}</button><button className="quiet" onClick={close}>Back to artwork</button></div> :
    <>
      {state !== 'loading' && !locked && !session.isNative && <div className={'viewfinder ' + (scan?'print-frame':'wall-frame') + (state==='wall-ready'?' ready':'')} aria-hidden="true"><i/><i/><i/><i/></div>}
      <div className="camera-floor">
        <div className={'camera-hint' + (locked?' locked':'')} role="status"><span className={state==='loading'?'spinner':'signal'}/>{message}</div>
        <div className="camera-controls">
          {!scan && !['placed','recovering'].includes(state) && <button className="solid" disabled={state!=='wall-ready'} onClick={() => controller.current?.place()}>Place here</button>}
          {!scan && ['placed','recovering'].includes(state) && <button className="glass-icon" aria-label="Move artwork" onClick={() => controller.current?.reset()}><Icon name="reset"/></button>}
          {!scan && state==='placed' && <><button className="glass-icon" aria-label="Decrease artwork size" disabled={width<=0.3} onClick={() => size(-0.1)}><Icon name="minus"/></button><button className="glass-icon" aria-label="Increase artwork size" disabled={width>=2.4} onClick={() => size(0.1)}><Icon name="plus"/></button></>}
          {!session.isNative && <CameraCapture canvasRef={canvas} locked={locked}
            onReview={() => {
              reviewingPhoto.current = true;
              controller.current?.stop();
              controller.current = null;
            }} onRetake={() => launch(session.mode, false)} onDismiss={close}/>}
          {state!=='loading' && <button className="glass-icon" aria-label={sound?'Mute film':'Unmute film'} onClick={toggleSound}><Icon name={sound?'sound':'mute'}/></button>}
        </div>
      </div>
    </>}
  </div>;
  return {active:!!session, launch, close, view, native};
}
