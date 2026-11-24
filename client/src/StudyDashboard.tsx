import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Glyph } from './interface';
import { Saara } from './Saara';
import { useRevisionSession } from './RevisionSession';
import { dayKey, documentUrl, shortDate, useStudyResource, type Attempt, type Course, type LibraryFile, type ReadingEntry, type Review } from './study-data';

export function ResourceNote({error,children}:{error?:string;children:ReactNode}) {
  return <p className={error ? 'gk-error' : 'desk-note'} role={error ? 'alert' : 'status'}>{error || children}</p>;
}

type Point = {date:Date; value:number};
export function CalendarBars({points,label,unit}:{points:Point[];label:string;unit:string}) {
  const id=useId();
  const max=Math.max(1,...points.map(p=>p.value));
  return <figure className="calendar-bars" aria-labelledby={id}>
    <figcaption id={id} className="visually-hidden">{label}</figcaption>
    <div className="bar-grid" aria-hidden="true">{points.map(p=><div className="bar-slot" key={dayKey(p.date)} title={shortDate(p.date)+' · '+p.value+' '+unit}>
      {points.length<=7 && <span className="bar-number">{p.value}</span>}
      <i style={{height:(p.value/max*68)+'%'}}/>
    </div>)}</div>
    <div className="bar-dates" aria-hidden="true">{(points.length<=7?points:[points[0],points[points.length-1]]).map(p=><span key={dayKey(p.date)}>{points.length<=7?p.date.toLocaleDateString(undefined,{weekday:'short'}):shortDate(p.date)}</span>)}</div>
    <details className="chart-data"><summary>Daily counts</summary><dl>{points.map(p=><div key={dayKey(p.date)}><dt>{shortDate(p.date)}</dt><dd>{p.value}</dd></div>)}</dl></details>
  </figure>;
}

export function calendarDays(count:number, counts:Map<string,number>, end=new Date()) {
  return Array.from({length:count},(_,i)=>{const date=new Date(end);date.setDate(date.getDate()-count+1+i);return {date,value:counts.get(dayKey(date))??0};});
}

type Props = { token:string; name:string; courses:Course[]; loading:boolean; classError?:string; history:ReadingEntry[]; join:()=>void };
export function StudentDashboard({token,name,courses,loading,classError,history,join}:Props) {
  const attempts=useStudyResource<{attempts:Attempt[]}>('/study/attempts',token);
  const reviews=useStudyResource<{items:Review[]}>('/study/review-queue',token);
  const {upcoming} = useRevisionSession();
  const library=useStudyResource<{files:LibraryFile[]}>('/assistant/library',token,history.length>0 || upcoming.length>0);
  const readable=new Map(library.data?.files.filter(f=>f.status==='ready' && !f.retracted_at).map(f=>[f.id,f]));
  const scheduled = upcoming.filter(item => readable.has(item.quizFileId) && Date.parse(item.dueAt)>Date.now()
    && !reviews.data?.items.some(due=>due.id===item.id));
  const reading=history.flatMap(entry=>{const file=readable.get(entry.id);return file?[{...entry,file}]:[];});
  const [last,...previous]=reading;
  const counts=new Map<string,number>();
  for (const attempt of attempts.data?.attempts??[]) {
    const day=dayKey(new Date(attempt.created_at)); counts.set(day,(counts.get(day)??0)+1);
  }
  const days=calendarDays(7,counts);
  const weekCount=days.reduce((sum,p)=>sum+p.value,0);
  return <div className="student-desk">
    <header className="desk-hero"><div className="desk-greeting">
      <p className="desk-dateline">{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</p>
      <h1>Welcome back, {name.split(' ')[0]}.</h1>
      <p>Pick up your reading or review a question from class.</p>
      <button className="gk-btn desk-join" onClick={join}><Glyph name="plus"/>Join Class</button>
    </div><Link className="saara-invite" to="/assistant"><Saara/><span>Study with SAARA <Glyph name="send"/></span></Link></header>
    <div className="desk-spread">
      <section className="reading-panel desk-panel"><h2><Glyph name="study"/>Continue reading</h2>
        {!library.data ? <ResourceNote error={library.error}>Loading your reading list…</ResourceNote> : last ?
          <><div className="reading-feature"><div className="book-spine" aria-hidden="true"><Glyph name="study"/><b>{last.file.format.toUpperCase()}</b></div><div><p className="desk-meta">{last.file.course_code || 'Personal library'}</p><h3><Link to={documentUrl(last.id,last.locator)}>{last.file.name}</Link></h3><Link className="desk-link" to={documentUrl(last.id,last.locator)}>Resume {last.locator || 'document'} <Glyph name="send"/></Link></div></div>
          {previous.length>0 && <div className="earlier-reading"><h4>Earlier this session</h4>{previous.map(entry=><Link key={entry.id} to={documentUrl(entry.id,entry.locator)}><Glyph name="material"/>{entry.file.name}</Link>)}</div>}
          <p className="desk-footnote">From documents opened this session.</p></> :
          <div className="desk-empty"><Glyph name="study"/><p>Open a document and it will appear here for the rest of this session.</p><Link className="desk-link" to="/spaces/personal">Open my files <Glyph name="send"/></Link></div>}
      </section>
      <section className="revision-panel desk-panel"><h2><Glyph name="review"/>Revision queue</h2>
        {!reviews.data ? <ResourceNote error={reviews.error}>Loading due questions…</ResourceNote> :
          <><div className="review-count"><strong>{reviews.data.items.length}</strong><span>{reviews.data.items.length===1 ? 'question' : 'questions'} due now</span></div>
          {reviews.data.items.length ? <><ul>{reviews.data.items.slice(0,2).map(r=>
            <li key={r.id}><b>{r.question}</b><span>{r.quizName} · Box {r.box} · Due {shortDate(r.dueAt)}</span></li>
          )}</ul>{reviews.data.items.length===50 && <p className="desk-footnote">Showing the first 50 due questions in the count.</p>}
          <Link className="desk-link" to="/study">Start revision <Glyph name="send"/></Link></> :
          <p className="desk-note">You’re caught up. Questions appear here when they’re due.</p>}
          {scheduled.length>0 && <div className="upcoming-revisions"><h3>Upcoming revision</h3>
            <p className="desk-footnote">Scheduled from reviews completed this session.</p>
            <ul>{scheduled.slice(0,2).map(item=><li key={item.id}><b>{item.question}</b>
              <span>{readable.get(item.quizFileId)?.name} · Due <time dateTime={item.dueAt}>{shortDate(item.dueAt)}</time></span></li>)}</ul>
          </div>}</>}
      </section>
    </div>
    <section className="desk-classes"><div className="desk-section-head"><h2>Your classrooms</h2>{!loading&&!classError&&<span>{courses.length} joined</span>}</div>
      {loading||classError ? <ResourceNote error={classError}>Loading classrooms…</ResourceNote> :
      courses.length ? <div className="course-shelves">{courses.map(c=><Link className="course-shelf gk-classroom-card" key={c.id} to={'/classroom/'+c.id}><span className="course-symbol"><Glyph name="classroom"/></span><span><small>{c.code}</small><strong>{c.name}</strong>{c.description && <span className="course-description">{c.description}</span>}</span><Glyph name="send"/></Link>)}</div> :
      <p className="desk-note">Join a classroom with the code from your professor.</p>}
    </section>
    <div className="desk-spread performance-spread"><section className="desk-panel"><div className="desk-section-head"><h2>Study activity</h2><span>Last 7 days</span></div>
      {attempts.data ? <><p className="activity-total"><strong>{weekCount}</strong> quiz {weekCount===1?'attempt':'attempts'}</p>
        <CalendarBars points={days} label="Quiz attempts by day" unit="attempts"/>
        {attempts.data.attempts.length===50&&<p className="desk-footnote">Based on the latest 50 attempts returned.</p>}</> : <ResourceNote error={attempts.error}>Loading activity…</ResourceNote>}
    </section><section className="desk-panel"><div className="desk-section-head"><h2>Recent quizzes</h2><Link className="desk-link" to="/study">History <Glyph name="send"/></Link></div>
      {!attempts.data ? <ResourceNote error={attempts.error}>Loading scores…</ResourceNote> : !attempts.data.attempts.length ? <p className="desk-note">Your scores will appear after your first quiz.</p> :
      <ol className="score-list">{attempts.data.attempts.slice(0,4).map(a=><li key={a.id}><div><Link to={documentUrl(a.quiz_file_id)}>{a.quiz_name}</Link><small>{shortDate(a.created_at)}</small></div><span className="score-chip">{a.score} / {a.total}</span></li>)}</ol>}
    </section></div>
  </div>;
}

