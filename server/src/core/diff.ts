import { diffArrays } from 'diff';
export function unitDiff(a: any[],b: any[]) {
  const ops:any[]=[];let ai=0,bi=0;
  for(const part of diffArrays(a.map(x=>x.text_hash),b.map(x=>x.text_hash))){
    const type=part.added?'added':part.removed?'removed':'same',count=part.value.length;
    const source=type==='removed'?a:b,offset=type==='removed'?ai:bi;
    ops.push({type,units:source.slice(offset,offset+count).map((x:any)=>({locator:x.locator,text:x.text}))});
    if(type!=='added')ai+=count;if(type!=='removed')bi+=count;
  }
  return ops;
}
