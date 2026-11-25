import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { request } from './api';
import { Dialog } from './interface';
import { documentUrl, useStudyResource, type LibraryFile } from './study-data';

type Quiz = { id: string; name: string; owner_type: 'org' | 'user'; owner_id: string; classroom_name?: string;
  score: number | null; total: number | null; students_attempted: number | null };
type Catalog = { quizzes: Quiz[] };

function QuizList({quizzes, faculty = false}: {quizzes: Quiz[]; faculty?: boolean}) {
  return <ul className="quiz-list">{quizzes.map(q => <li key={q.id}>
    <div><Link to={documentUrl(q.id)}>{q.name.replace(/\.quiz\.json$/i, '')}</Link>
      <small>{faculty ? `${q.students_attempted ?? 0} student${q.students_attempted === 1 ? '' : 's'} attempted` :
        [q.classroom_name || 'Personal practice', q.score === null ? 'Ready to attempt' : `Latest score ${q.score} / ${q.total}`].join(' · ')}</small>
    </div>
    <Link className="desk-link" aria-label={`${faculty ? 'Open' : 'Attempt'} ${q.name}`} to={documentUrl(q.id)}>
      {faculty ? 'Open' : q.score === null ? 'Attempt' : 'Try again'}</Link>
  </li>)}</ul>;
}

function PracticeForm({token, close}: {token: string; close: () => void}) {
  const navigate = useNavigate();
  const library = useStudyResource<{files: (LibraryFile & {available: boolean})[]}>('/assistant/library', token);
  const files = library.data?.files.filter(f => f.available) ?? [];
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!selected.length || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request('/assistant/quiz', token, {method: 'POST',
        body: JSON.stringify({fileIds: selected, numQuestions: count, difficulty})});
      navigate(documentUrl(result.fileId));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not generate the quiz.'); setBusy(false); }
  }
  return <Dialog title="Create a practice quiz" onDismiss={() => { if (!busy) close(); }}>
    <form className="gk-modal-form" onSubmit={generate}>
      <p className="desk-note">Choose resources for SAARA. Only you can see this quiz and your scores.</p>
      <fieldset className="quiz-resources" disabled={busy}><legend>Study resources</legend>
        {library.error ? <p role="alert">{library.error}</p> : !library.data ? <p>Loading resources…</p> :
          !files.length ? <p>No ready resources yet. <Link to="/spaces/personal">Add a file</Link> to get started.</p> :
          files.map(f => <label key={f.id}><input type="checkbox" checked={selected.includes(f.id)}
            onChange={e => setSelected(e.target.checked ? [...selected, f.id] : selected.filter(id => id !== f.id))}/>
            <span>{f.name}<small>{f.course_code || 'Personal library'}</small></span></label>)}
      </fieldset>
      <div className="quiz-settings"><div><label htmlFor="practice-count">Questions</label><select id="practice-count" disabled={busy} value={count} onChange={e => setCount(Number(e.target.value))}>
        {[3,5,10].map(n => <option key={n}>{n}</option>)}</select></div>
        <div><label htmlFor="practice-difficulty">Difficulty</label><select id="practice-difficulty" disabled={busy} value={difficulty} onChange={e => setDifficulty(e.target.value)}>
          <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div></div>
      {error && <p className="gk-error" role="alert">{error}</p>}
      <div className="gk-modal-footer"><button type="button" className="gk-btn gk-btn-ghost" disabled={busy} onClick={close}>Cancel</button>
        <button className="gk-btn gk-btn-primary" disabled={busy || !selected.length}>{busy ? 'Generating quiz…' : 'Generate practice quiz'}</button></div>
    </form>
  </Dialog>;
}

export function StudentQuizzes({token}: {token: string}) {
  const [creating, setCreating] = useState(false);
  const catalog = useStudyResource<Catalog>('/study/quizzes', token, true);
  const classroom = catalog.data?.quizzes.filter(q => q.owner_type === 'org') ?? [];
  const practice = catalog.data?.quizzes.filter(q => q.owner_type === 'user') ?? [];
  return <section className="desk-panel quiz-panel"><div className="desk-section-head"><h2>Quizzes</h2>
    <button className="gk-btn gk-btn-secondary" onClick={() => setCreating(true)}>Create practice quiz</button></div>
    {catalog.error ? <p className="gk-error" role="alert">{catalog.error}</p> : !catalog.data ? <p role="status">Loading quizzes…</p> :
      <div className="quiz-columns"><section><h3>From your professors</h3>{classroom.length ? <QuizList quizzes={classroom}/> :
        <p className="desk-note">Quizzes published to your classrooms will appear here.</p>}</section>
      <section><h3>Personal practice</h3>{practice.length ? <QuizList quizzes={practice}/> :
        <p className="desk-note">Create a quiz from your notes or classroom resources.</p>}</section></div>}
    {creating && <PracticeForm token={token} close={() => setCreating(false)}/>}
  </section>;
}

type Question = { question: string; options: string[]; correctIndex: number };
const blankQuestion = (): Question => ({ question: '', options: ['', '', '', ''], correctIndex: -1 });

function PublishForm({token, classroomId, classroomName, close, published}: {
  token: string; classroomId: string; classroomName: string; close: () => void; published: () => void;
}) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>(() => [blankQuestion()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(index: number, fields: Partial<Question>) {
    setQuestions(items => items.map((q,i) => i === index ? {...q, ...fields} : q));
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await request(`/classrooms/${classroomId}/quizzes`, token, {method: 'POST', body: JSON.stringify({title, questions})});
      published();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish the quiz.'); setBusy(false); }
  }
  return <Dialog title="Publish a classroom quiz" onDismiss={() => { if (!busy) close(); }}>
    <form className="gk-modal-form" onSubmit={publish}>
      <p className="desk-note">All students in {classroomName} can attempt this quiz once you publish it.</p>
      <label className="gk-field">Quiz title<input required maxLength={160} disabled={busy} value={title} onChange={e => setTitle(e.target.value)}/></label>
      {questions.map((q,i) => <fieldset className="quiz-editor" key={i} disabled={busy}><legend>Question {i+1}</legend>
        <label>Question text<textarea required rows={2} maxLength={2000} value={q.question} onChange={e => update(i,{question: e.target.value})}/></label>
        {q.options.map((o,j) => <label key={j}>Choice {j+1}<input required maxLength={500} value={o} onChange={e => update(i,{options: q.options.map((v,k) => k === j ? e.target.value : v)})}/></label>)}
        <label>Correct answer<select required value={q.correctIndex < 0 ? '' : q.correctIndex} onChange={e => update(i,{correctIndex: Number(e.target.value)})}>
          <option value="" disabled>Select a choice</option>{q.options.map((_,j) => <option key={j} value={j}>Choice {j+1}</option>)}</select></label>
        {questions.length > 1 && <button type="button" className="gk-text-btn" onClick={() => setQuestions(items => items.filter((_,j) => j !== i))}>Remove question {i+1}</button>}
      </fieldset>)}
      <button className="gk-btn gk-btn-secondary" type="button" disabled={busy || questions.length >= 50} onClick={() => setQuestions(items => [...items, blankQuestion()])}>Add question</button>
      {error && <p className="gk-error" role="alert">{error}</p>}
      <div className="gk-modal-footer"><button className="gk-btn gk-btn-ghost" type="button" disabled={busy} onClick={close}>Cancel</button>
        <button className="gk-btn gk-btn-primary" disabled={busy}>{busy ? 'Publishing…' : 'Publish quiz'}</button></div>
    </form>
  </Dialog>;
}

export function FacultyQuizzes({token, classroomId, classroomName}: {token: string; classroomId: string; classroomName: string}) {
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const catalog = useStudyResource<Catalog>('/study/quizzes', token, true, revision);
  const quizzes = catalog.data?.quizzes.filter(q => q.owner_type === 'org' && q.owner_id === classroomId) ?? [];
  return <section className="desk-panel quiz-panel" id="classroom-quizzes"><div className="desk-section-head"><h2>Classroom quizzes</h2>
    <button className="gk-btn gk-btn-primary" onClick={() => setCreating(true)}>Create classroom quiz</button></div>
    {revision > 0 && <p role="status" className="gk-notice">Quiz published to {classroomName}.</p>}
    {catalog.error ? <p role="alert" className="gk-error">{catalog.error}</p> : !catalog.data ? <p>Loading quizzes…</p> :
      quizzes.length ? <QuizList faculty quizzes={quizzes}/> : <p className="desk-note">Publish the first quiz for {classroomName}.</p>}
    {creating && <PublishForm token={token} classroomId={classroomId} classroomName={classroomName}
      close={() => setCreating(false)} published={() => { setCreating(false); setRevision(n => n + 1); }}/>}
  </section>;
}
