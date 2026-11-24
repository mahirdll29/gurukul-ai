import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Glyph } from './interface';
import { CalendarBars, calendarDays, ResourceNote } from './StudyDashboard';
import { dayKey, documentUrl, useStudyResource, type Analytics, type Material } from './study-data';

function MaterialSummary({token,classroomId}:{token:string;classroomId:string}) {
  const materials=useStudyResource<{files:Material[]}>('/files?scope=org:'+encodeURIComponent(classroomId)+'&includeArchived=false',token,true);
  if (!materials.data) return <ResourceNote error={materials.error}>Loading material status…</ResourceNote>;
  const files=materials.data.files;
  const counts:Record<string,number>={Ready:0,Processing:0,Failed:0,Other:0};
  for (const f of files) {
    const version=f.versions.find(v=>v.id===f.current_version_id)??f.versions[0];
    const state=version?.job_status || version?.status;
    if (state==='succeeded'||state==='ready') counts.Ready++;
    else if (['queued','processing','running'].includes(state)) counts.Processing++;
    else if (['failed','dead'].includes(state)) counts.Failed++;
    else counts.Other++;
  }
  return <><p className="ledger-total"><strong>{files.length}</strong> active {files.length===1?'material':'materials'}</p>
    <div className="status-track" aria-hidden="true">{Object.entries(counts).filter(([,n])=>n>0).map(([s,n])=><i key={s} className={'fill-'+s.toLowerCase()} style={{flex:n}}/>)}</div>
    <dl className="status-key">{Object.entries(counts).filter(([s,n])=>s!=='Other'||n>0).map(([s,n])=><div key={s}><dt><i className={'fill-'+s.toLowerCase()}/>{s}</dt><dd>{n}</dd></div>)}</dl>
  </>;
}

export function ClassroomInsights({token,classroomId}:{token:string;classroomId:string}) {
  const result=useStudyResource<Analytics>('/classrooms/'+encodeURIComponent(classroomId)+'/analytics',token,true);
  if (!result.data) return <ResourceNote error={result.error}>Loading classroom insights…</ResourceNote>;
  const data=result.data;
  const counts=new Map(data.activity.map(d=>[d.day.length===10?d.day:dayKey(new Date(d.day)),Number(d.count)]));
  const total=data.activity.reduce((sum,d)=>sum+Number(d.count),0);
  const first=new Date(); first.setDate(first.getDate()-30);
  const days=calendarDays(counts.has(dayKey(first))?31:30,counts);
  const max=Math.max(1,...data.mostCitedFiles.map(f=>Number(f.citations)));
  return <div className="insights-sheet">
    <header className="insights-heading"><div><h2>Classroom insights</h2></div><span className="period-tag">Last 30 days</span></header>
    <div className="insights-lead"><section className="activity-panel"><h3>Classroom activity</h3>
      <p className="ledger-total"><strong>{total.toLocaleString()}</strong> recorded {total===1?'event':'events'}</p>
      <p className="desk-note">Searches and assistant requests linked to classroom material.</p>
      <CalendarBars points={days} label="Daily classroom usage events" unit="events"/>
    </section><section className="processing-panel"><h3>Material processing</h3><p className="desk-note">Current class inventory</p><MaterialSummary token={token} classroomId={classroomId}/></section></div>
    <div className="insight-columns"><section><div className="desk-section-head"><h3>Most cited materials</h3><Glyph name="files"/></div>
      {data.mostCitedFiles.length ? <ol className="citation-ranks">{data.mostCitedFiles.map(f=><li key={f.file_id}><div><Link to={documentUrl(f.file_id)}>{f.file_name}</Link><span>{f.citations} {Number(f.citations)===1?'citation':'citations'}</span></div><i aria-hidden="true" style={{width:(Number(f.citations)/max*100)+'%'}}/></li>)}</ol> : <p className="desk-note">Cited materials will appear after an assistant answer references a class document.</p>}
    </section><section><div className="desk-section-head"><h3>Most cited sections</h3><Glyph name="study"/></div>
      {data.mostCitedUnits.length ? <ul className="section-cites">{data.mostCitedUnits.map(u=><li key={u.unit_id}><Link to={documentUrl(u.file_id,u.locator)}><b>{u.locator}</b><span>{u.file_name}</span></Link><small>{u.citations} {Number(u.citations)===1?'citation':'citations'}</small></li>)}</ul> : <p className="desk-note">Section citations will link to the referenced passage.</p>}
    </section></div>
    <section className="topic-ledger"><div className="desk-section-head"><h3>Classroom topics</h3>{data.topicsWithheld&&<Glyph name="lock"/>}</div>
      <p className="desk-note">{data.message}</p>
      {data.topicsWithheld ? <p className="privacy-label">Topic data is withheld for privacy.</p> : data.topics.length ?
        <ul>{data.topics.map(t=><li key={t.term}><b>{t.term}</b><span>{t.count} students</span></li>)}</ul> : <p className="desk-note">No topic meets the reporting threshold yet.</p>}
    </section>
  </div>;
}

type FacultyCourse={orgId:string;code:string;name:string;role:string};
export function FacultyOverview({token,courses}:{token:string;courses:FacultyCourse[]}) {
  const faculty=courses.filter(c=>c.role==='faculty');
  const [selected,setSelected]=useState('');
  const course=faculty.find(c=>c.orgId===selected)??faculty[0];
  return <section className="faculty-overview">
    <header className="faculty-cover"><div><p className="desk-meta">Faculty workspace</p><h1>Teaching dashboard</h1></div>
      {course&&<div className="course-selector"><label htmlFor="faculty-course">Classroom</label><select id="faculty-course" value={course.orgId} onChange={e=>setSelected(e.target.value)}>{faculty.map(c=><option key={c.orgId} value={c.orgId}>{c.code} · {c.name}</option>)}</select></div>}
    </header>
    {course ? <ClassroomInsights key={course.orgId} token={token} classroomId={course.orgId}/> : <p className="desk-note">Classroom insights appear here once you teach a class.</p>}
  </section>;
}

