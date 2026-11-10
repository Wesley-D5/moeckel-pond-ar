import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {seasons, film, printTarget} from '../content.js';
import {Icon} from './icons.jsx';
import {Dialog, PhoneCode} from './dialog.jsx';
import {useCamera} from './camera.jsx';

const seasonIcons = ['sprout','sun','leaf','snow'];
const initialSeason = Math.max(0, seasons.findIndex(s => s.id === location.hash.slice(1)));
const mobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const appleAR = !!document.createElement('a').relList?.supports?.('ar');

function App() {
  const [index, setIndex] = useState(initialSeason);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [nativeMotion, setNativeMotion] = useState(true);
  const preview = useRef(null), player = useRef(null), scene = useRef(null);
  const cursor = useRef([0,0]), gesture = useRef(null);
  const timer = useRef(null), dialogTrigger = useRef(null), playbackRequest = useRef(0), camera = useCamera();
  const current = seasons[index];
  const homeUrl = location.origin + location.pathname;

  function notify(text) {
    clearTimeout(timer.current); setToast(text);
    timer.current = setTimeout(() => setToast(''), 4500);
  }

  function openDialog(kind, event) {
    dialogTrigger.current = event?.currentTarget || document.activeElement;
    pause();
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    requestAnimationFrame(() => dialogTrigger.current?.focus());
  }

  function choose(next) {
    const selected = (next+4)%4;
    setIndex(selected);
    pause();
    setElapsed(seasons[selected].time);
    if (player.current?.readyState) player.current.currentTime=seasons[selected].time;
    history.replaceState(null, '', '#'+seasons[selected].id);
  }

  function pause() {
    ++playbackRequest.current;
    player.current?.pause(); setPlaying(false);
  }

  async function toggleFilm() {
    const video = player.current;
    if (!video) return;
    if (playing) { pause(); return; }
    if (!video.getAttribute('src')) { video.src=film; video.load(); }
    const request = ++playbackRequest.current;
    try { await video.play(); if (playbackRequest.current===request && !video.paused) setPlaying(true); }
    catch { if (playbackRequest.current===request) notify('The film could not play. Check your connection and try again.'); }
  }

  async function share() {
    const url = homeUrl+'#'+current.id;
    if (navigator.share) {
      try { await navigator.share({title:'Moeckel Pond Seasons',text:'A living landscape in four seasons.',url}); return; }
      catch(e) { if(e.name==='AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); notify('Artwork link copied.'); }
    catch { openDialog('share'); }
  }

  function moveScene(x,y) {
    cursor.current=[Math.max(-1,Math.min(1,x)),Math.max(-1,Math.min(1,y))];
    scene.current?.setOffset(...cursor.current);
  }

  useEffect(() => {
    let disposed=false;
    let instance;
    if (playing || camera.active || dialog || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    import('./parallax.js').then(({mountParallax}) => {
      if (disposed) return;
      instance=mountParallax({canvas:preview.current,imageUrl:current.image});
      scene.current=instance;
      instance.setOffset(...cursor.current);
    }).catch(() => {});
    return () => {disposed=true; instance?.dispose(); if(scene.current===instance) scene.current=null;};
  }, [index,playing,dialog,camera.active]);

  useEffect(() => {
    const hidden=() => {if(document.hidden) pause();};
    document.addEventListener('visibilitychange',hidden);
    return () => document.removeEventListener('visibilitychange',hidden);
  }, []);

  function launch(mode, native=true) {
    const focus = dialogTrigger.current;
    setDialog(null);
    pause();
    camera.launch(mode,native,focus);
  }

  const fullscreen = dialog === 'film';

  return <>
    <div className="site" inert={camera.active?true:undefined} aria-hidden={camera.active?true:undefined}>
      <header className="site-header">
        <a className="brand" href="./" aria-label="Moeckel Pond home"><img src="./mark.svg" alt="" width="36" height="36"/><span>Moeckel Pond</span></a>
        <div className="header-actions"><button className="guide-button" onClick={e => openDialog('guide',e)}><Icon name="guide" size={17}/><span>Field guide</span></button><span className="header-divider"/><button className="icon-button" aria-label="Share artwork" onClick={share}><Icon name="share" size={20}/></button></div>
      </header>
      <main id="artwork">
        <section className="hero" aria-labelledby="artwork-title">
          <div className="art-column">
            <div className="artwork-wrap">
              <div className="art-mat">
                <div className="artwork" role="group" aria-label="Interactive artwork preview" tabIndex="0"
                  onPointerMove={e => {
                    if (e.pointerType==='mouse' && !gesture.current) {
                      const r=e.currentTarget.getBoundingClientRect(); moveScene((e.clientX-r.left)/r.width*2-1,(e.clientY-r.top)/r.height*2-1);
                    } else if(gesture.current) {
                      moveScene((e.clientX-gesture.current[0])/150,(e.clientY-gesture.current[1])/150);
                    }
                  }}
                  onPointerDown={e => {if(e.target.closest('button'))return; gesture.current=[e.clientX,e.clientY]; e.currentTarget.setPointerCapture(e.pointerId);}}
                  onPointerUp={() => {gesture.current=null;moveScene(0,0);}}
                  onPointerCancel={() => {gesture.current=null;moveScene(0,0);}}
                  onPointerLeave={() => {if(!gesture.current)moveScene(0,0);}}
                  onKeyDown={e => {if(e.target!==e.currentTarget)return; if(['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();choose(index+(e.key==='ArrowRight'?1:-1));} if(e.key===' '){e.preventDefault();toggleFilm();}}}
                >
                  <img className="art-still" src={current.image} alt={current.alt} width="1920" height="1080" fetchPriority="high"/>
                  <canvas ref={preview} className={'depth-preview'+(playing?' concealed':'')} aria-hidden="true"/>
                  <video ref={player} playsInline muted={!sound} loop preload="none" className={'film-preview'+(playing?' is-playing':'')} aria-label="Moeckel Pond Seasons film" aria-hidden={!playing}
                    onLoadedMetadata={() => {player.current.currentTime=seasons[index].time;}}
                    onTimeUpdate={e => {const t=e.currentTarget.currentTime; setElapsed(t); if(playing) {let n=0;seasons.forEach((s,i)=>{if(t>=s.time)n=i;});setIndex(n);}}}
                    onError={() => {pause();notify('The film could not load. Please try again.');}}
                  />
                  <div className="art-overlay">
                    <button className="art-film-toggle" onClick={toggleFilm}><Icon name={playing?'pause':'play'} size={15}/><span>{playing?'Pause film':'Play the film'}</span></button>
                    <div className="art-tools">{playing&&<button className="art-icon" aria-label={sound?'Mute film':'Unmute film'} onClick={() => setSound(!sound)}><Icon name={sound?'sound':'mute'} size={17}/></button>}<button className="art-icon" aria-label="Expand artwork" onClick={e => openDialog('film',e)}><Icon name="expand" size={17}/></button></div>
                  </div>
                  {playing&&<div className="film-progress"><span style={{width:(elapsed/41.458*100)+'%'}}/></div>}
                </div>
              </div>
            </div>
            <div className="art-caption"><div><span className="season-mark"><Icon name={seasonIcons[index]} size={15}/>{current.name}</span><span className="caption-divider"/><span>{playing?'41-second seasonal film':'Move across the artwork to explore'}</span></div><div className="arrows"><button aria-label="Previous season" onClick={() => choose(index-1)}><Icon name="left" size={15}/></button><button aria-label="Next season" onClick={() => choose(index+1)}><Icon name="right" size={15}/></button></div></div>
          </div>
          <div className="intro">
            <div className="intro-copy"><p className="eyebrow"><span/>AUGMENTED REALITY</p><h1 id="artwork-title">Moeckel Pond<br/><em>Through the seasons.</em></h1><p className="description">Watch the old mill pass from spring wildflowers to autumn gold and winter frost.</p></div>
            <div className="main-actions">
              <button className="mode-button primary" onClick={e => openDialog('scan',e)}><span className="mode-icon"><Icon name="scan" size={25}/></span><span><strong>Scan a print</strong><small>Watch your poster come to life</small></span><Icon name="ne" size={19}/></button>
              <button className="mode-button secondary" onClick={e => openDialog('wall',e)}><span className="mode-icon"><Icon name="cube" size={25}/></span><span><strong>Place on your wall</strong><small>Find a home for the artwork</small></span><Icon name="ne" size={19}/></button>
              <p className="device-note"><Icon name="scan" size={13}/>8th Wall<span>·</span>Apple Quick Look</p>
            </div>
          </div>
        </section>
        <section className="seasons" aria-labelledby="seasons-heading">
          <div className="section-heading"><h2 id="seasons-heading">Explore the seasons</h2><p>Choose a moment to explore</p></div>
          <div className="season-grid">{seasons.map((s,i) => <button key={s.id} className={'season-card'+(index===i?' selected':'')} aria-pressed={index===i} onClick={() => choose(i)}>
            <img src={s.image} alt="" width="480" height="270" loading="lazy"/><span className="season-shade"/><span className="season-name"><Icon name={seasonIcons[i]} size={17}/>{s.name}</span><span className="season-selected"><Icon name={index===i?'check':'ne'} size={15}/></span>
          </button>)}</div>
        </section>
      </main>
      <footer className="site-footer"><p>Moeckel Pond Seasons</p><div><a href={printTarget} download="Moeckel-Pond-Print.jpg"><Icon name="poster" size={15}/>Get the print<Icon name="ne" size={12}/></a><button onClick={e => openDialog('about',e)}>About this experience</button></div></footer>
    </div>
    {dialog && <Dialog title={{scan:'Scan a print',wall:'Place on your wall',guide:'Field guide',about:'About this experience',film:'Moeckel Pond film',share:'Share artwork'}[dialog]} kind={fullscreen?'film-dialog':''} close={closeDialog}>
      {fullscreen ? <><video className="expanded-film" src={film} poster={current.image} controls playsInline autoPlay loop onLoadedMetadata={e => {e.currentTarget.currentTime=current.time;}}/><div className="expanded-caption"><span>Moeckel Pond</span><span>Through the seasons · 0:41</span></div></> :
      <>
        <div className="modal-emblem"><Icon name={dialog==='wall'?'cube':dialog==='scan'?'scan':dialog==='share'?'share':'guide'} size={27}/></div>
        {dialog==='scan'&&<>
          <p className="eyebrow">PRINT TO LIFE</p><h2>Let the seasons unfold.</h2><p className="dialog-intro">Point your camera at the original Moeckel Pond poster. The film will follow the print.</p>
          <div className="print-demo"><img src={printTarget} alt="The exact Moeckel Pond print to scan"/><span><Icon name="scan" size={24}/></span></div>
          <p className="tip">Keep all four corners visible, with even light and minimal glare.</p>
          <button className="solid" onClick={() => launch('scan',false)}><Icon name="scan"/>Open camera<Icon name="arrow"/></button>
          <a className="quiet" href={printTarget} download="Moeckel-Pond-Print.jpg">Get the printable artwork<Icon name="ne" size={14}/></a>
          {!mobile&&<PhoneCode url={homeUrl}/>}
          <p className="privacy">Camera frames are processed on your device.</p>
        </>}
        {dialog==='wall'&&<>
          <p className="eyebrow">ART IN YOUR SPACE</p><h2>Make room for the pond.</h2><p className="dialog-intro">Bring a seasonal framed artwork into your room with Apple Quick Look, or place the original film with browser AR.</p>
          {appleAR ? <>
            <div className="native-options" role="group" aria-label="Native artwork type"><button aria-pressed={nativeMotion} onClick={() => setNativeMotion(true)}>Four seasons</button><button aria-pressed={!nativeMotion} onClick={() => setNativeMotion(false)}>{current.name} still</button></div>
            <div className="native-card native-choice"><a className="quick-look-asset" rel="ar" href={nativeMotion?'./assets/moeckel-pond-seasons.usdz':current.usdz} aria-label={nativeMotion?'Place the four seasons in Apple Quick Look':'Place the '+current.name.toLowerCase()+' still in Apple Quick Look'}><img src={nativeMotion?seasons[0].image:current.image} alt=""/></a><span><strong>{nativeMotion?'Place the four seasons':'Place '+current.name.toLowerCase()+' artwork'}</strong><small>Apple Quick Look · {nativeMotion?'seasonal transitions':'framed still'}</small></span><Icon name="ne"/></div>
            {nativeMotion&&<p className="native-note">Seasons blend on compatible iOS 18+ devices. Older viewers display the spring artwork.</p>}
          </> : <div className="native-card native-explainer"><img src={current.image} alt=""/><span><strong>Apple Quick Look</strong><small>Open in Safari on iPhone or iPad for native seasonal artwork and framed prints.</small></span></div>}
          {mobile || camera.native ? <button className="solid" onClick={() => launch('wall',true)}><Icon name="film"/>Place the animated film<Icon name="arrow"/></button> : <button className="solid" onClick={() => setDialog('film')}><Icon name="play"/>Watch the film here<Icon name="arrow"/></button>}
          {(mobile || camera.native)&&<p className="tip">Move slowly across a textured wall until a surface is found. Then tap to place.</p>}
          {!mobile&&<PhoneCode url={homeUrl+'#'+current.id}/>}
          {(mobile || camera.native)&&<p className="privacy">Animated placement uses {camera.native?'native WebXR':'8th Wall'} tracking.</p>}
        </>}
        {dialog==='guide'&&<>
          <p className="eyebrow">FIELD GUIDE</p><h2>A good place to start.</h2>
          <div className="guide-entry"><Icon name="scan"/><div><h3>Bring a print to life</h3><p>Use the original poster below. Hold it flat in even light, keep its corners in view, and move the camera slowly. Matte paper helps reduce glare.</p><a href={printTarget} download="Moeckel-Pond-Print.jpg">Get the print<Icon name="ne" size={14}/></a></div></div>
          <div className="guide-entry"><Icon name="cube"/><div><h3>Give the artwork a wall</h3><p>On compatible iPhone or iPad devices, Apple Quick Look blends the four seasons in a native framed artwork. The animated film uses browser AR. Choose a textured wall with visible detail and move from side to side to find a surface.</p></div></div>
          <div className="guide-entry"><Icon name="sun"/><div><h3>Let the camera see clearly</h3><p>Soft daylight, a clean lens and a steady hand help tracking. If the artwork loses its position, bring the print back into view or use the move control to place it again.</p></div></div>
          {!mobile&&<PhoneCode url={homeUrl}/>}
        </>}
        {dialog==='about'&&<>
          <p className="eyebrow">MOECKEL POND SEASONS</p><h2>A landscape in motion.</h2><p className="dialog-intro">The original 41-second film moves from spring wildflowers through summer, autumn and winter. Each season here is a still from that film.</p>
          <div className="about-detail"><h3>Made for your space</h3><p>8th Wall image and world tracking bring the film into your camera. Supported devices can use native WebXR for animated wall placement. Apple Quick Look offers native seasonal transitions and individual framed stills.</p></div>
          <div className="about-detail"><h3>Made with care</h3><p>Your camera frames stay on your device. Camera access starts when you choose Open camera or animated placement.</p></div>
          <p className="license">This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial, Inc. All rights reserved. <a href="./tracking/engine/LICENSE" target="_blank" rel="noreferrer">Engine license</a>. Built with React and Three.js.</p>
        </>}
        {dialog==='share'&&<><h2>Share a moment.</h2><p className="dialog-intro">Copy the link or scan it on your phone.</p><input className="share-url" aria-label="Artwork URL" readOnly value={homeUrl+'#'+current.id} onFocus={e=>e.target.select()}/><PhoneCode url={homeUrl+'#'+current.id}/></>}
      </>}
    </Dialog>}
    {camera.view}
    <div className={'toast'+(toast?' visible':'')} role="status">{toast&&<><Icon name="check" size={16}/>{toast}</>}</div>
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
