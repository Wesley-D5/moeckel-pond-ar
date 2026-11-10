import React, {useEffect, useRef, useState} from 'react';
import {Icon} from './icons.jsx';

export function Dialog({title, kind, close, children}) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    node.showModal();
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; if (node.open) node.close(); };
  }, []);
  return <dialog ref={ref} className={'dialog '+kind} aria-label={title} onCancel={e => {e.preventDefault(); close();}} onClick={e => {if(e.target===ref.current) {const r=ref.current.getBoundingClientRect(); if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) close();}}}>
    <button className="dialog-close" aria-label="Close dialog" onClick={close}><Icon name="close"/></button>
    {children}
  </dialog>;
}

export function PhoneCode({url}) {
  const [code, setCode] = useState('');
  useEffect(() => {
    let alive = true;
    import('./assets/qrcode.mjs').then(({qrcode}) => {
      const qr = qrcode(0,'M'); qr.addData(url); qr.make();
      if (alive) setCode(qr.createSvgTag({cellSize:4,margin:16,scalable:true}));
    }).catch(() => {});
    return () => { alive=false; };
  }, [url]);
  return code && <div className="phone-code"><div className="qr" role="img" aria-label="QR code to open this artwork on a phone" dangerouslySetInnerHTML={{__html:code}}/><div><strong>Open on your phone</strong><p>Point your phone camera at the code.</p></div></div>;
}
