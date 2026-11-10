import React from 'react';

const drawings = {
  scan: <><path d="M3 9V6a3 3 0 0 1 3-3h3m6 0h3a3 3 0 0 1 3 3v3m0 6v3a3 3 0 0 1-3 3h-3m-6 0H6a3 3 0 0 1-3-3v-3"/><path d="M6 12h12"/></>,
  cube: <><path d="m12 2.7 8.5 4.8v9L12 21.3l-8.5-4.8v-9zM3.8 7.5l8.2 4.8 8.2-4.8M12 12.3v9"/><path d="m8 5 8.5 4.8"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  ne: <path d="M6 18 18 6M6 6h12v12"/>,
  share: <><path d="M12 15V3m-4 4 4-4 4 4m-10 4H4v9h16v-9h-2"/></>,
  guide: <><path d="M3 4.5c3-.7 6-.6 9 1.5 3-2.1 6-2.2 9-1.5v15c-3-.7-6-.6-9 1.5-3-2.1-6-2.2-9-1.5zM12 6v15"/></>,
  play: <path d="m8 5 11 7-11 7z" fill="currentColor" strokeWidth="0"/>,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="3.8"/></>,
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  left: <path d="m14.5 5-7 7 7 7"/>, right: <path d="m9.5 5 7 7-7 7"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  sprout: <><path d="M11 21c0-6 1-11 7-16m-7 10c-5 0-8-4-8-8 5 0 9 3 8 8zm1-3C12 6 16 3 21 3c0 6-3 10-9 9z"/></>,
  leaf: <><path d="M18 3C17 9 7 6 5 13c-2 7 5 9 10 5 3.5-3 5-8 3-15zM3 21c4-4 7-4 12-10"/></>,
  snow: <><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4m10 14-1-4 4-1M4 14l4 1-1 4m10-14-1 4 4 1"/></>,
  check: <path d="m5 12 4.5 4.5L19 7"/>,
  sound: <><path d="M3 10h4l5-5v14l-5-5H3zM15.5 8.5a5 5 0 0 1 0 7m2.5-10a9 9 0 0 1 0 13"/></>,
  mute: <><path d="M3 10h4l5-5v14l-5-5H3zm13-1 6 6m0-6-6 6"/></>,
  poster: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1"/><path d="m5 18 4.5-5 3 3 3.5-5 4 5"/></>,
  qr: <><path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h3v3h3m-6 3h3m3-9v3"/></>,
  reset: <><path d="M4 10a8 8 0 1 1 1 8m-1-8V4m0 6h6"/></>,
  plus: <path d="M5 12h14M12 5v14"/>, minus: <path d="M5 12h14"/>,
  film: <><rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18M7 4.5l3 4.5m3-4.5 3 4.5"/></>,
};
export function Icon({name, size=20, ...props}) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>{drawings[name]}</svg>;
}
