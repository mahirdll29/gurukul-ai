import { useEffect, useRef, type ReactNode } from 'react';

const paths = {
  home: 'M3 10 12 3l9 7v10h-6v-6H9v6H3z',
  classroom: 'M3 4h18v12H3z M8 21l4-5 4 5',
  files: 'M3 7V5h6l2 2h10v13H3z',
  ai: 'm12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  dashboard: 'M3 3v18h18 M7 16v-4 M12 16V6 M17 16V9',
  trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  signout: 'M10 4H4v16h6 M9 12h12m-5-5 5 5-5 5',
  upload: 'M12 16V3m-5 5 5-5 5 5 M4 15v6h16v-6',
  close: 'm6 6 12 12 M18 6 6 18', send: 'M4 12h16m-7-7 7 7-7 7',
  back: 'M20 12H4m7-7-7 7 7 7', menu: 'M3 6h18 M3 12h18 M3 18h18',
  plus: 'M12 5v14 M5 12h14', check: 'm4 12 5 5L20 6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  material: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h6',
  people: 'M3 21v-2a6 6 0 0 1 12 0v2 M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M16 5a4 4 0 0 1 0 7m2 3a5 5 0 0 1 3 5',
  copy: 'M8 8h12v13H8z M4 16H2V2h13v2',
  review: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6 M12 7v5l4 2',
  study: 'M2 5q6-2 10 1 4-3 10-1v14q-6-2-10 1-4-3-10-1z M12 6v14',
  student: 'm2 9 10-5 10 5-10 5z M6 11v5q6 5 12 0v-5 M22 9v7',
  mail: 'M2 5h20v14H2z M2 5l10 8L22 5',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3',
  user: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21a8 8 0 0 1 16 0',
};
export function Glyph({name}:{name:keyof typeof paths}) {
  return <svg className="glyph" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
export function Brand() {
  return <span className="wordmark"><span className="brand-mark"><Glyph name="study" /></span>Gurukul<span className="brand-ai">AI</span></span>;
}
export function Dialog({title,onDismiss,children}:{title:string;onDismiss:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current!; dialog.showModal(); return ()=>dialog.close();},[]);
  return <dialog ref={ref} className="gk-modal" aria-label={title} onCancel={event=>{event.preventDefault();onDismiss();}} onClick={event=>{if(event.target===ref.current)onDismiss();}}>
    <div className="dialog-sheet"><div className="gk-modal-header"><h2>{title}</h2><button className="gk-icon-btn" aria-label="Close dialog" onClick={onDismiss}><Glyph name="close"/></button></div>{children}</div>
  </dialog>;
}

