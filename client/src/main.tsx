import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter, Link, Navigate, Route, Routes,
  useLocation, useNavigate, useParams,
} from 'react-router-dom';
import './style.css';

const API = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/api' : `${window.location.origin}/api`)).replace(/\/$/, '');

type Membership = { orgId: string; code: string; name: string; role: 'faculty' | 'student' };
type User = { id: string; name: string; email: string; accountRole: 'student' | 'professor'; memberships: Membership[] };
type FileRow = { id: string; name: string; format: string; visibility: string; created_at?: string; versions?: { id: string; version_no: number; status: string; size_bytes: number; job_status?: string; job_attempts?: number; job_max_attempts?: number }[]; archived_at?: string | null };
function ingestionLabel(version: any) {
  const status = version?.job_status;
  if (status === 'queued') return 'Queued';
  if (status === 'running') return `Processing${version.job_attempts ? ` · attempt ${version.job_attempts}/${version.job_max_attempts}` : ''}`;
  if (status === 'dead' || status === 'failed') return 'Failed';
  return version?.status || 'Processing';
}
type AuthState = { token: string; user: User | null; portal: 'student' | 'professor' };

async function request(path: string, token: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`Cannot reach the Gurukul-AI API at ${API}. Check that the server is running.`);
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (response.status !== 204 && !contentType.includes('application/json'))
    throw new Error(`The server at ${API} did not return API JSON.`);
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Request failed (HTTP ${response.status}).`);
  return data;
}

async function uploadToApi(file: File, token: string, params: Record<string, unknown>, onProgress?: (value:number)=>void) {
  const fallback = async () => {
    const data = new FormData(); data.append('file', file);
    for (const [key, value] of Object.entries(params)) data.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    return request('/files', token, { method: 'POST', body: data });
  };
  let init: any;
  try {
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    init = await request('/files/uploads/init', token, { method: 'POST', body: JSON.stringify({ ...params, filename: file.name, size: file.size, sha256 }) });
  } catch { const result = await fallback(); return { ...result, fallback: true }; }
  if (init.deduped) return { ...init, direct: true };
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('PUT', init.url);
      for (const [key, value] of Object.entries(init.headers || {})) xhr.setRequestHeader(key, String(value));
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Object storage upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error('Direct upload failed; retrying through the API.'));
      xhr.onabort = () => reject(new Error('Direct upload was interrupted.'));
      xhr.send(file);
    });
  } catch { const result = await fallback(); return { ...result, fallback: true }; }
  return { ...(await request(`/files/uploads/${init.uploadId}/complete`, token, { method: 'POST', body: '{}' })), direct: true };
}

// ─── CLASSROOM BANNER COLOURS (cycles) ───────────────────────────────────────
const BANNER_PALETTES = [
  { bg: 'linear-gradient(135deg,#35483c 0%,#526552 100%)', accent: '#b7c39e' },
  { bg: 'linear-gradient(135deg,#713d30 0%,#a15b43 100%)', accent: '#e5b397' },
  { bg: 'linear-gradient(135deg,#4e5348 0%,#797b65 100%)', accent: '#d0c69e' },
  { bg: 'linear-gradient(135deg,#7d542d 0%,#a67840 100%)', accent: '#e4c48b' },
  { bg: 'linear-gradient(135deg,#3c5553 0%,#607977 100%)', accent: '#b2cbc2' },
  { bg: 'linear-gradient(135deg,#6a4547 0%,#926363 100%)', accent: '#dfb4a9' },
];
function palette(id: string) {
  let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return BANNER_PALETTES[Math.abs(hash) % BANNER_PALETTES.length];
}

// ─── ICONS ────────────────────────────────────────────────────────────────────
const Icon = {
  home: '⌂', classroom: '▦', files: '▤', ai: '✳', search: '⌕', dashboard: '▥',
  trash: '⌫', signout: '↗', upload: '↑', close: '×', send: '↗', back: '←',
  menu: '☰', plus: '+', check: '✓', eye: '◉', download: '↓', announce: '!',
  material: '▧', people: '◎', copy: '▢', settings: '⚙',
};

// ─── AUTH / LOGIN ─────────────────────────────────────────────────────────────
function Login({ initialPortal, onLogin }: { initialPortal: 'student' | 'professor'; onLogin: (token: string, user: User, portal: 'student' | 'professor') => void }) {
  const [portal, setPortal] = useState<'student' | 'professor'>(initialPortal);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);

  function selectPortal(next: 'student' | 'professor') { setPortal(next); setMode('login'); setError(''); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
      const body = mode === 'register' ? { name, email, password, portal } : { email, password, portal };
      const d = await request(endpoint, '', { method: 'POST', body: JSON.stringify(body) });
      onLogin(d.token, d.user, portal);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="gk-login-page">
      <div className="gk-login-wrap">
        <div className="gk-login-brand">
          <div className="gk-brand-logo">G</div>
          <h1 className="gk-brand-name">Gurukul-AI</h1>
          <p className="gk-brand-tagline">Your AI-powered classroom, reimagined.</p>
        </div>
        <div className="gk-login-card">
          <div className="gk-portal-tabs" role="tablist">
            <button type="button" className={`gk-portal-tab${portal === 'student' ? ' active' : ''}`} onClick={() => selectPortal('student')}>Student</button>
            <button type="button" className={`gk-portal-tab${portal === 'professor' ? ' active' : ''}`} onClick={() => selectPortal('professor')}>Professor</button>
          </div>
          <h2 className="gk-login-title">{mode === 'register' ? `Create ${portal} account` : 'Sign in'}</h2>
          <form className="gk-login-form" onSubmit={submit}>
            {mode === 'register' && (
              <div className="gk-field">
                <label htmlFor="reg-name">Full name</label>
                <input id="reg-name" type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" minLength={1} maxLength={100} required />
              </div>
            )}
            <div className="gk-field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
            </div>
            <div className="gk-field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} required />
            </div>
            {error && <div className="gk-error" role="alert">{error}</div>}
            <button className="gk-btn gk-btn-primary" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="gk-login-switch">
            {mode === 'register' ? 'Already have an account?' : 'New to Gurukul-AI?'}{' '}
            <button type="button" className="gk-text-btn" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>
              {mode === 'register' ? 'Sign in' : `Create ${portal} account`}
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
function App() {
  const storedPortal = localStorage.getItem('portal') === 'professor' ? 'professor' : 'student';
  const [auth, setAuth] = useState<AuthState>({ token: localStorage.getItem('token') || '', user: null, portal: storedPortal });
  const [checking, setChecking] = useState(Boolean(localStorage.getItem('token')));
  const location = useLocation(); const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!auth.token) { setChecking(false); return; }
    request('/auth/me', auth.token).then(d => {
      const memberships = d.memberships || [];
      const portal = d.user.accountRole === 'professor' ? 'professor' : 'student';
      localStorage.setItem('portal', portal);
      setAuth(a => ({ ...a, portal, user: { ...d.user, memberships } }));
    }).catch(() => {
      localStorage.removeItem('token'); localStorage.removeItem('portal');
      setAuth({ token: '', user: null, portal: 'student' });
    }).finally(() => setChecking(false));
  }, [auth.token]);

  const login = (token: string, user: User, portal: 'student' | 'professor') => {
    localStorage.setItem('token', token); localStorage.setItem('portal', portal);
    setAuth({ token, user, portal });
    navigate(portal === 'professor' ? '/professor' : '/student');
  };
  const logout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('portal');
    setAuth({ token: '', user: null, portal: 'student' });
    navigate('/student/login');
  };

  if (checking) return <div className="gk-loading"><div className="gk-spinner" /><span>Loading Gurukul-AI…</span></div>;
  if (!auth.token || !auth.user) {
    const initialPortal = location.pathname.startsWith('/professor') ? 'professor' : 'student';
    return <Login key={initialPortal} initialPortal={initialPortal} onLogin={login} />;
  }

  const portalCourses = auth.user.memberships.filter(m => auth.portal === 'professor' ? m.role === 'faculty' : m.role === 'student');
  const navLinks: { label: string; href: string; icon: string }[] =
    auth.portal === 'professor'
      ? [{ label: 'Home', href: '/professor', icon: Icon.home }, { label: 'My Files', href: '/spaces/personal', icon: Icon.files }, { label: 'AI Assistant', href: '/assistant', icon: Icon.ai }, { label: 'Search', href: '/search', icon: Icon.search }, { label: 'Dashboard', href: '/dashboard', icon: Icon.dashboard }, { label: 'Trash', href: '/trash', icon: Icon.trash }]
      : [{ label: 'Home', href: '/student', icon: Icon.home }, { label: 'My Files', href: '/spaces/personal', icon: Icon.files }, { label: 'AI Assistant', href: '/assistant', icon: Icon.ai }, { label: 'Search', href: '/search', icon: Icon.search }, { label: 'Study', href: '/study', icon: '✎' }, { label: 'Dashboard', href: '/dashboard', icon: Icon.dashboard }];

  const isActive = (href: string) => location.pathname === href || (href !== '/professor' && href !== '/student' && location.pathname.startsWith(href));

  return (
    <div className="gk-shell">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="gk-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`gk-sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="gk-sidebar-header">
          <Link className="gk-sidebar-brand" to={auth.portal === 'professor' ? '/professor' : '/student'} onClick={() => setSidebarOpen(false)}>
            <span className="gk-sidebar-logo">G</span>
            <span>Gurukul-AI</span>
          </Link>
        </div>

        <nav className="gk-sidebar-nav">
          {navLinks.map(({ label, href, icon }) => (
            <Link key={href} to={href} className={`gk-nav-link${isActive(href) ? ' active' : ''}`} onClick={() => setSidebarOpen(false)}>
              <span className="gk-nav-icon">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>

        <div className="gk-sidebar-section-label">
          {auth.portal === 'professor' ? 'My Classes' : 'Enrolled Classes'}
        </div>
        <div className="gk-sidebar-classes">
          {portalCourses.map(m => {
            const p = palette(m.orgId);
            return (
              <Link key={m.orgId} to={`/classroom/${m.orgId}`}
                className={`gk-sidebar-class${location.pathname === `/classroom/${m.orgId}` ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <span className="gk-class-dot" style={{ background: p.accent }} />
                <span className="gk-class-label">{m.code} · {m.name}</span>
              </Link>
            );
          })}
          {!portalCourses.length && <p className="gk-sidebar-empty">No classes yet</p>}
        </div>

        <div className="gk-sidebar-footer">
          <div className="gk-user-info">
            <div className="gk-user-avatar">{auth.user.name.charAt(0).toUpperCase()}</div>
            <div>
              <strong>{auth.user.name}</strong>
              <span>{auth.portal === 'professor' ? 'Professor' : 'Student'}</span>
            </div>
          </div>
          <div className="gk-footer-actions">
            {(auth.portal === 'professor' || auth.user.memberships.some(m => m.role === 'faculty')) && (
              <button className="gk-text-btn" onClick={() => {
                const next = auth.portal === 'professor' ? 'student' : 'professor';
                localStorage.setItem('portal', next);
                setAuth(a => ({ ...a, portal: next }));
                navigate(next === 'professor' ? '/professor' : '/student');
                setSidebarOpen(false);
              }}>Switch portal</button>
            )}
            <button className="gk-text-btn" onClick={logout}>{Icon.signout} Sign out</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="gk-main">
        {/* Top bar (mobile) */}
        <header className="gk-topbar">
          <button className="gk-topbar-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>{Icon.menu}</button>
          <Link className="gk-topbar-brand" to={auth.portal === 'professor' ? '/professor' : '/student'}>Gurukul-AI</Link>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to={auth.portal === 'professor' ? '/professor' : '/student'} replace />} />
          <Route path="/student" element={<PortalPage user={auth.user} portal="student" token={auth.token} />} />
          <Route path="/professor" element={auth.portal === 'professor' ? <PortalPage user={auth.user} portal="professor" token={auth.token} /> : <Navigate to="/student" replace />} />
          <Route path="/classroom/:id" element={<ClassroomPage token={auth.token} user={auth.user} portal={auth.portal} />} />
          <Route path="/spaces/:space" element={<FilesPage token={auth.token} user={auth.user} />} />
          <Route path="/files/:id" element={<FilePage token={auth.token} />} />
          <Route path="/search" element={<SearchPage token={auth.token} />} />
          <Route path="/assistant" element={<AssistantPage token={auth.token} />} />
          <Route path="/study" element={<StudyPage token={auth.token} />} />
          <Route path="/dashboard" element={<DashboardPage token={auth.token} isProfessor={auth.user.accountRole === 'professor'} />} />
          <Route path="/trash" element={<TrashPage token={auth.token} />} />
          <Route path="*" element={<Navigate to={auth.portal === 'professor' ? '/professor' : '/student'} replace />} />
        </Routes>
      </div>
    </div>
  );
}

// ─── PORTAL PAGE (Home) ───────────────────────────────────────────────────────
function PortalPage({ user, portal, token }: { user: User; portal: 'student' | 'professor'; token: string }) {
  const [classrooms, setClassrooms] = useState<any[]>([]);
  const [className, setClassName] = useState(''), [classCode, setClassCode] = useState(''), [description, setDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false), [showJoin, setShowJoin] = useState(false);
  const navigate = useNavigate();

  const refresh = useCallback(() =>
    request('/classrooms', token).then(d => setClassrooms(d.classrooms || [])).catch(e => setError(e.message)), [token]);
  useEffect(() => { refresh(); }, [refresh]);

  const courses = classrooms.filter(c => portal === 'professor' ? c.role === 'faculty' : c.role === 'student');

  async function createClass(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await request('/classrooms', token, { method: 'POST', body: JSON.stringify({ name: className, code: classCode, description }) });
      setShowCreate(false); setClassName(''); setClassCode(''); setDescription('');
      setNotice('Classroom created!'); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create classroom.'); }
    finally { setBusy(false); }
  }

  async function joinClass(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const d = await request('/classrooms/join', token, { method: 'POST', body: JSON.stringify({ joinCode }) });
      setShowJoin(false); setJoinCode('');
      setNotice(`Joined ${d.classroom?.name || 'classroom'}!`); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not join classroom.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="gk-page gk-portal-page">
      <div className="gk-portal-header">
        <div>
          <h1>Welcome, {user.name.split(' ')[0]} 👋</h1>
          <p>{portal === 'professor' ? 'Manage your classrooms and course materials.' : 'Your enrolled classrooms and study materials.'}</p>
        </div>
        <div className="gk-portal-actions">
          {portal === 'professor'
            ? <button className="gk-btn gk-btn-primary" onClick={() => setShowCreate(true)}>{Icon.plus} New Classroom</button>
            : <button className="gk-btn gk-btn-primary" onClick={() => setShowJoin(true)}>{Icon.plus} Join Class</button>
          }
          <Link className="gk-btn gk-btn-secondary" to="/assistant">{Icon.ai} AI Assistant</Link>
        </div>
      </div>

      {error && <div className="gk-error gk-error-bar" role="alert">{error} <button className="gk-text-btn" onClick={() => setError('')}>{Icon.close}</button></div>}
      {notice && <div className="gk-notice gk-notice-bar">{notice} <button className="gk-text-btn" onClick={() => setNotice('')}>{Icon.close}</button></div>}

      {/* Create classroom modal */}
      {showCreate && (
        <div className="gk-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="gk-modal" onClick={e => e.stopPropagation()}>
            <div className="gk-modal-header">
              <h2>Create a classroom</h2>
              <button className="gk-icon-btn" onClick={() => setShowCreate(false)}>{Icon.close}</button>
            </div>
            <form className="gk-modal-form" onSubmit={createClass}>
              <div className="gk-field"><label>Class name *<input value={className} onChange={e => setClassName(e.target.value)} placeholder="e.g. Introduction to Computing" maxLength={120} required /></label></div>
              <div className="gk-field"><label>Class code (optional)<input value={classCode} onChange={e => setClassCode(e.target.value.toUpperCase())} placeholder="e.g. CS101" maxLength={24} /></label></div>
              <div className="gk-field"><label>Description<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What students will learn…" rows={3} maxLength={1000} /></label></div>
              <div className="gk-modal-footer">
                <button type="button" className="gk-btn gk-btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="gk-btn gk-btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join classroom modal */}
      {showJoin && (
        <div className="gk-modal-backdrop" onClick={() => setShowJoin(false)}>
          <div className="gk-modal" onClick={e => e.stopPropagation()}>
            <div className="gk-modal-header">
              <h2>Join a classroom</h2>
              <button className="gk-icon-btn" onClick={() => setShowJoin(false)}>{Icon.close}</button>
            </div>
            <form className="gk-modal-form" onSubmit={joinClass}>
              <div className="gk-field"><label>Classroom join code<input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="10-character code from your professor" maxLength={10} minLength={10} autoCapitalize="characters" required /></label></div>
              <p className="gk-hint">Ask your professor for the join code shown on their classroom page.</p>
              <div className="gk-modal-footer">
                <button type="button" className="gk-btn gk-btn-ghost" onClick={() => setShowJoin(false)}>Cancel</button>
                <button className="gk-btn gk-btn-primary" disabled={busy || joinCode.trim().length !== 10}>{busy ? 'Joining…' : 'Join'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Classroom grid */}
      {courses.length === 0
        ? (
          <div className="gk-empty-state">
            <div className="gk-empty-icon">{Icon.classroom}</div>
            <h2>{portal === 'professor' ? 'No classrooms yet' : 'Not enrolled in any class'}</h2>
            <p>{portal === 'professor' ? 'Create your first classroom to get a join code for students.' : 'Enter a join code from your professor to enroll.'}</p>
          </div>
        )
        : (
          <div className="gk-classroom-grid">
            {courses.map(c => {
              const p = palette(c.id);
              return (
                <div key={c.id} className="gk-classroom-card" onClick={() => navigate(`/classroom/${c.id}`)}>
                  <div className="gk-card-banner" style={{ background: p.bg }}>
                    <div className="gk-card-banner-title">{c.name}</div>
                    <div className="gk-card-banner-code">{c.code}</div>
                  </div>
                  <div className="gk-card-body">
                    {c.description && <p className="gk-card-desc">{c.description}</p>}
                    <div className="gk-card-meta">
                      {portal === 'professor'
                        ? <><span>{Icon.people} {c.student_count} students</span><span title="Join code" className="gk-join-code">{Icon.copy} {c.join_code}</span></>
                        : <span>Open class →</span>
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ─── CLASSROOM PAGE (Google Classroom-like) ───────────────────────────────────
function ClassroomPage({ token, user, portal }: { token: string; user: User; portal: 'student' | 'professor' }) {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<'stream' | 'materials' | 'members' | 'insights'>('stream');
  const [classroom, setClassroom] = useState<any>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<File | null>(null);
  const [selectedFiles,setSelectedFiles]=useState<File[]>([]);
  const [uploading, setUploading] = useState(false), [uploadMsg, setUploadMsg] = useState('');
  const [uploadProgress,setUploadProgress]=useState<number|null>(null);
  const [visibility, setVisibility] = useState<'classroom' | 'selected'>('classroom');
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const membership = user.memberships.find(m => m.orgId === id);
  const isFaculty = membership?.role === 'faculty' || portal === 'professor';
  const filteredClassmates = members.filter(person => person.name.toLowerCase().includes(shareSearch.trim().toLowerCase()));

  const refreshFiles = useCallback(() => {
    setBusy(true);
    request(`/files?scope=org:${id}&includeArchived=false`, token)
      .then(d => setFiles(d.files || []))
      .catch(e => setError(e.message))
      .finally(() => setBusy(false));
  }, [id, token]);

  useEffect(() => {
    setShareWith([]);
    setShareSearch('');
    request('/classrooms', token).then(d => {
      const cls = (d.classrooms || []).find((c: any) => c.id === id);
      setClassroom(cls || null);
    }).catch(e => setError(e.message));
    refreshFiles();
    request(`/classrooms/${id}/members`, token)
      .then(d => setMembers(d.members || []))
      .catch(() => setMembers([]));
  }, [id, token, refreshFiles]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (visibility === 'selected' && !shareWith.length) {
      setError('Choose at least one classmate to share with, or share with everyone.');
      return;
    }
    setUploading(true); setError(''); setUploadMsg('');
    try {
      const pending=selectedFiles.length?selectedFiles:[selected];let fallback=false,deduped=0;
      for(const file of pending){const result=await uploadToApi(file,token,{scope:`org:${id}`,visibility,shareWith},setUploadProgress);fallback ||= Boolean(result.fallback);if(result.deduped||result.dedup?.exact)deduped++;}
      setUploadMsg(`${pending.length} file${pending.length===1?'':'s'} uploaded. ${deduped} matched existing content.${fallback?' Direct upload fell back to the API.':' Processing…'}`);
      setSelected(null);setSelectedFiles([]); if (fileInputRef.current) fileInputRef.current.value = '';
      setShareWith([]);
      setTimeout(refreshFiles, 2000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setUploading(false); setUploadProgress(null); }
  }

  const p = classroom ? palette(id) : BANNER_PALETTES[0];

  function copyCode() {
    if (classroom?.join_code) { navigator.clipboard.writeText(classroom.join_code); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  return (
    <div className="gk-classroom-page">
      {/* Banner */}
      <div className="gk-class-banner" style={{ background: p.bg }}>
        <div className="gk-class-banner-inner">
          <div>
            <h1 className="gk-class-title">{classroom?.name || 'Loading…'}</h1>
            <p className="gk-class-subtitle">{classroom?.code}{classroom?.description ? ` · ${classroom.description}` : ''}</p>
          </div>
          {isFaculty && classroom?.join_code && (
            <div className="gk-join-code-badge" onClick={copyCode} title="Click to copy join code">
              <span className="gk-join-label">Join code</span>
              <span className="gk-join-value">{classroom.join_code}</span>
              <span className="gk-join-copy">{copied ? Icon.check : Icon.copy}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="gk-class-tabs">
        {(['stream', 'materials', 'members', ...(isFaculty?['insights' as const]:[])] as const).map(t => (
          <button key={t} className={`gk-class-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'stream' ? `${Icon.announce} Stream` : t === 'materials' ? `${Icon.material} Materials` : t === 'members' ? `${Icon.people} Members` : 'Insights'}
          </button>
        ))}
      </div>

      {error && <div className="gk-error gk-error-bar" role="alert" style={{ margin: '0 24px 0' }}>{error} <button className="gk-text-btn" onClick={() => setError('')}>{Icon.close}</button></div>}
      {uploadMsg && <div className="gk-notice gk-notice-bar" style={{ margin: '0 24px 12px' }}>{uploadMsg}</div>}
      {uploadProgress!==null&&<div style={{margin:'0 24px 12px'}}><progress value={uploadProgress} max={100} /> {uploadProgress}%</div>}

      <div className="gk-class-body">
        {/* ── STREAM TAB ── */}
        {tab === 'stream' && (
          <div className="gk-stream-layout">
            {/* Sidebar info card */}
            <aside className="gk-stream-sidebar">
              {isFaculty && classroom?.join_code && (
                <div className="gk-info-card">
                  <div className="gk-info-card-title">Class join code</div>
                  <div className="gk-info-code" onClick={copyCode} title="Click to copy">
                    {classroom.join_code}
                    <span>{copied ? ' Copied!' : ` ${Icon.copy}`}</span>
                  </div>
                  <p className="gk-hint">Share this with students to let them join.</p>
                </div>
              )}
              <div className="gk-info-card">
                <div className="gk-info-card-title">About this class</div>
                <div className="gk-info-row"><span>Code</span><strong>{classroom?.code || '—'}</strong></div>
                <div className="gk-info-row"><span>Members</span><strong>{members.length + 1}</strong></div>
                <div className="gk-info-row"><span>Files</span><strong>{files.length}</strong></div>
              </div>
              <div className="gk-info-card">
                <Link className="gk-btn gk-btn-secondary" style={{ width: '100%', justifyContent: 'center' }} to={`/assistant?classId=${id}`}>{Icon.ai} Study with AI</Link>
              </div>
            </aside>

            {/* Stream feed */}
            <div className="gk-stream-feed">
              {/* Upload / Post panel */}
              <div className="gk-post-panel">
                <div className="gk-post-panel-header">
                  <span>{isFaculty ? `${Icon.upload} Share materials or announce` : `${Icon.upload} Share a file`}</span>
                </div>
                <form onSubmit={upload} className="gk-post-form">
                  {!selected
                    ? (
                      <label className="gk-file-drop" htmlFor="class-file-input">
                        <input id="class-file-input" type="file" accept=".docx,.pptx,.pdf" multiple ref={fileInputRef}
                          onChange={e => {const files=Array.from(e.target.files||[]);setSelectedFiles(files);setSelected(files[0]||null);}} style={{ display: 'none' }} />
                        <span className="gk-file-drop-icon">{Icon.upload}</span>
                        <span>Click to upload a PDF, PPTX, or DOCX</span>
                      </label>
                    )
                    : (
                      <div className="gk-selected-file">
                        <span>{Icon.material} {selectedFiles.length>1?`${selected.name} + ${selectedFiles.length-1} more`:selected.name}</span>
                        <button type="button" className="gk-icon-btn" onClick={() => { setSelected(null);setSelectedFiles([]); if (fileInputRef.current) fileInputRef.current.value = ''; }}>{Icon.close}</button>
                      </div>
                    )
                  }

                  {/* Student selective sharing */}
                  {selected && membership && (
                    <div className="gk-share-controls">
                      <label className="gk-field">
                        Share with
                        <select value={visibility} onChange={e => setVisibility(e.target.value as 'classroom' | 'selected')}>
                          <option value="classroom">Everyone in this classroom</option>
                          <option value="selected">Only selected students</option>
                        </select>
                      </label>
                      {visibility === 'selected' && (
                        <div className="gk-classmate-picker">
                          <strong>{isFaculty ? 'Select students' : 'Select classmates'} ({shareWith.length} selected)</strong>
                          <input aria-label="Search classmates" placeholder="Search classmates by name…" value={shareSearch} onChange={e => setShareSearch(e.target.value)} />
                          {filteredClassmates.length
                            ? filteredClassmates.map(person => (
                              <label key={person.id} className="gk-classmate-option">
                                <input type="checkbox" checked={shareWith.includes(person.id)}
                                  onChange={() => setShareWith(cur => cur.includes(person.id) ? cur.filter(i => i !== person.id) : [...cur, person.id])} />
                                <span className="gk-classmate-avatar">{person.name.charAt(0)}</span>
                                {person.name}
                              </label>
                            ))
                            : <small>{members.length ? 'No classmates match that name.' : 'No other students in this class yet.'}</small>
                          }
                        </div>
                      )}
                    </div>
                  )}

                  {selected && (
                    <button className="gk-btn gk-btn-primary" disabled={uploading || (visibility === 'selected' && !shareWith.length)}>
                      {uploading ? 'Uploading…' : 'Post'}
                    </button>
                  )}
                </form>
              </div>

              {/* Recent files as stream posts */}
              {busy
                ? <div className="gk-loading-inline"><div className="gk-spinner" /><span>Loading…</span></div>
                : files.length === 0
                  ? <div className="gk-empty-state gk-empty-inline"><span style={{ fontSize: 40 }}>{Icon.material}</span><p>No materials yet.{isFaculty ? ' Upload the first file!' : ' Your professor hasn\'t posted anything yet.'}</p></div>
                  : files.map(f => {
                    const latest = f.versions?.[0];
                    return (
                      <StreamPost key={f.id} file={f} latest={latest} classroomId={id} />
                    );
                  })
              }
            </div>
          </div>
        )}

        {/* ── MATERIALS TAB ── */}
        {tab === 'materials' && (
          <div className="gk-materials-page">
            <div className="gk-materials-header">
              <h2>Class Materials</h2>
              <label className="gk-btn gk-btn-primary">
                {Icon.upload} Upload
                <input type="file" accept=".docx,.pptx,.pdf" multiple style={{ display: 'none' }} onChange={async e => {
                  const files = Array.from(e.target.files||[]); if (!files.length) return;
                  setUploading(true); setError(''); setUploadMsg('');
                  try {
                    for(const file of files)await uploadToApi(file,token,{scope:`org:${id}`,visibility:'classroom',shareWith:[]},setUploadProgress);
                    setUploadMsg(`✓ ${files.length} file${files.length===1?'':'s'} uploaded. Processing…`);
                    setTimeout(refreshFiles, 2000);
                  } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
                  finally { setUploading(false);setUploadProgress(null); e.target.value = ''; }
                }} />
              </label>
            </div>
            {busy
              ? <div className="gk-loading-inline"><div className="gk-spinner" /></div>
              : files.length === 0
                ? <div className="gk-empty-state">No files yet.</div>
                : (
                  <div className="gk-materials-grid">
                    {files.map(f => {
                      const latest = f.versions?.[0];
                      return (
                        <Link key={f.id} to={`/files/${f.id}`} className="gk-material-card">
                          <div className="gk-material-icon">{f.format === 'pdf' ? '📄' : f.format === 'pptx' ? '📊' : '📝'}</div>
                          <div className="gk-material-info">
                            <strong>{f.name}</strong>
                            <small>{f.format.toUpperCase()} · {latest ? `${(Number(latest.size_bytes) / 1024).toFixed(1)} KB` : '—'} · <span className={`gk-badge ${latest?.status}`}>{ingestionLabel(latest)}</span></small>
                          </div>
                          <span className="gk-material-arrow">→</span>
                        </Link>
                      );
                    })}
                  </div>
                )
            }
          </div>
        )}

        {/* ── MEMBERS TAB ── */}
        {tab === 'members' && (
          <div className="gk-members-page">
            <div className="gk-members-section">
              <h3>{Icon.people} Teachers</h3>
              <div className="gk-member-list">
                <div className="gk-member-row">
                  <div className="gk-member-avatar">{user.name.charAt(0)}</div>
                  <div>
                    <strong>{isFaculty ? user.name : classroom?.teacher_name || 'Professor'}</strong>
                    <small>Faculty</small>
                  </div>
                </div>
              </div>
            </div>
            <div className="gk-members-section">
              <h3>{Icon.people} Students ({members.length})</h3>
              <div className="gk-member-list">
                {members.length === 0
                  ? <p className="gk-hint">No students have joined yet.</p>
                  : members.map(m => (
                    <div key={m.id} className="gk-member-row">
                      <div className="gk-member-avatar">{m.name.charAt(0)}</div>
                      <div><strong>{m.name}</strong><small>Student</small></div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}
        {tab === 'insights' && isFaculty && <ClassroomInsights token={token} classroomId={id} />}
      </div>
    </div>
  );
}

function ClassroomInsights({token,classroomId}:{token:string;classroomId:string}){
  const [data,setData]=useState<any>(null),[visible,setVisible]=useState(false),[error,setError]=useState(''),ref=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{if(!ref.current)return;const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)));observer.observe(ref.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!visible)return;const load=()=>request(`/classrooms/${classroomId}/analytics`,token).then(setData).catch(e=>setError(e.message));load();const timer=setInterval(load,10000);return()=>clearInterval(timer);},[visible,classroomId,token]);
  const max=Math.max(1,...(data?.activity||[]).map((x:any)=>Number(x.count)));
  return <div ref={ref} className="gk-class-members"><h2>Class insights</h2><p className="gk-hint">Topics are shown only when enough distinct students ask about them. No user identities or raw queries appear here.</p>{error&&<p className="gk-error">{error}</p>}{!data?<p className="gk-hint">Loading classroom insights…</p>:<><p>{data.message}</p><h3>Activity · last 30 days</h3><div style={{display:'flex',alignItems:'end',gap:4,height:120,overflowX:'auto'}}>{data.activity.map((d:any)=><div key={d.day} title={`${d.day}: ${d.count}`} style={{minWidth:12,height:`${Math.max(5,Number(d.count)/max*100)}%`,background:'#6d7b61',borderRadius:4}} />)}</div><h3>Most cited materials</h3>{data.mostCitedFiles.map((x:any)=><p key={x.file_id}>{x.file_name} · {x.citations} citations</p>)}<h3>Most cited sections</h3>{data.mostCitedUnits.map((x:any)=><p key={x.unit_id}>{x.file_name} · {x.locator} · {x.citations}</p>)}<h3>Top topics</h3>{data.topicsWithheld?<p>Topic data is withheld for privacy.</p>:data.topics.map((x:any)=><span className="gk-badge" key={x.term} style={{margin:4}}>{x.term} · {x.count}</span>)}</>}</div>;
}

function StreamPost({ file, latest, classroomId }: { file: FileRow; latest: any; classroomId: string }) {
  const isReady = latest?.status === 'ready';
  return (
    <div className="gk-stream-post">
      <div className="gk-post-icon">{file.format === 'pdf' ? '📄' : file.format === 'pptx' ? '📊' : '📝'}</div>
      <div className="gk-post-content">
        <div className="gk-post-meta">
          <span className="gk-post-type">{file.format.toUpperCase()} · {file.visibility === 'classroom' ? 'Everyone' : 'Selected students'}</span>
          <span className={`gk-badge ${latest?.status}`}>{ingestionLabel(latest)}</span>
        </div>
        <Link to={`/files/${file.id}`} className="gk-post-title">{file.name}</Link>
        <div className="gk-post-actions">
          <Link to={`/files/${file.id}`} className="gk-btn gk-btn-ghost gk-btn-sm">{Icon.eye} View in app</Link>
          {isReady && <Link to={`/assistant?fileId=${file.id}`} className="gk-btn gk-btn-ghost gk-btn-sm">{Icon.ai} Ask AI</Link>}
        </div>
      </div>
    </div>
  );
}

// ─── FILES PAGE (personal / org space) ───────────────────────────────────────
function FilesPage({ token, user }: { token: string; user: User }) {
  const { space = 'personal' } = useParams();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const [selectedFiles,setSelectedFiles]=useState<File[]>([]);
  const [uploading, setUploading] = useState(false), [message, setMessage] = useState('');
  const [uploadProgress,setUploadProgress]=useState<number|null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [visibility, setVisibility] = useState<'classroom' | 'selected'>('classroom');
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [shareSearch, setShareSearch] = useState('');

  const membership = user.memberships.find(m => m.orgId === space);
  const filteredClassmates = members.filter(person => person.name.toLowerCase().includes(shareSearch.trim().toLowerCase()));
  const canUpload = space === 'personal' || Boolean(membership);
  const scope = space === 'personal' ? 'personal' : `org:${space}`;

  useEffect(() => {
    if (space === 'personal') { setMembers([]); return; }
    request(`/classrooms/${space}/members`, token).then(d => setMembers(d.members || [])).catch(() => setMembers([]));
  }, [space, token]);

  useEffect(() => {
    setVisibility(space === 'personal' || membership?.role === 'faculty' ? 'classroom' : 'selected');
    setShareWith([]);
    setShareSearch('');
  }, [space, membership?.role]);

  const refresh = useCallback(() => {
    setBusy(true);
    request(`/files?scope=${encodeURIComponent(scope)}&includeArchived=${showArchived}`, token)
      .then(d => setFiles(d.files || [])).catch(e => setError(e.message)).finally(() => setBusy(false));
  }, [scope, showArchived, token]);
  useEffect(() => { refresh(); }, [refresh]);

  async function upload(e: React.FormEvent) {
    e.preventDefault(); if (!selected) return;
    if (space !== 'personal' && membership?.role === 'student' && visibility === 'selected' && !shareWith.length) {
      setError('Choose at least one classmate or share with the whole classroom.'); return;
    }
    setUploading(true); setError(''); setMessage('');
    try {
      const pending=selectedFiles.length?selectedFiles:[selected];let fallback=false,deduped=0;
      for(const file of pending){const result=await uploadToApi(file,token,{scope,visibility,shareWith},setUploadProgress);fallback ||= Boolean(result.fallback);if(result.deduped||result.dedup?.exact)deduped++;}
      setMessage(`${pending.length} file${pending.length===1?'':'s'} uploaded; ${deduped} matched existing content.${fallback?' Direct upload fell back to the API.':''}`);
      setSelected(null);setSelectedFiles([]); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setUploading(false); setUploadProgress(null); }
  }

  const title = space === 'personal' ? 'My personal files' : `${membership?.code || 'Course'} ${membership?.name || ''}`.trim();

  return (
    <div className="gk-page">
      <div className="gk-page-header">
        <div><h1>{title}</h1><p>Documents, versions, and study materials.</p></div>
        {canUpload && (
          <label className="gk-btn gk-btn-primary">
            {Icon.upload} Upload file
                <input type="file" accept=".docx,.pptx,.pdf" multiple style={{ display: 'none' }} onChange={e => {const files=Array.from(e.target.files||[]);setSelectedFiles(files);setSelected(files[0]||null);}} />
          </label>
        )}
      </div>

      {selected && (
        <form className="gk-upload-form" onSubmit={upload}>
          <div className="gk-upload-file-row">
            <span>{Icon.material} {selectedFiles.length>1?`${selected.name} + ${selectedFiles.length-1} more`:selected.name}</span>
            <button type="button" className="gk-icon-btn" onClick={() => setSelected(null)}>{Icon.close}</button>
          </div>
          {space !== 'personal' && membership?.role === 'student' && (
            <div className="gk-share-controls">
              <label className="gk-field">Share with
                <select value={visibility} onChange={e => setVisibility(e.target.value as 'classroom' | 'selected')}>
                  <option value="selected">Only selected classmates</option>
                  <option value="classroom">Everyone in this classroom</option>
                </select>
              </label>
              {visibility === 'selected' && (
                <div className="gk-classmate-picker">
                  <strong>Select classmates ({shareWith.length} selected)</strong>
                  <input aria-label="Search classmates" placeholder="Search classmates by name…" value={shareSearch} onChange={e => setShareSearch(e.target.value)} />
                  {filteredClassmates.length
                    ? filteredClassmates.map(person => (
                      <label key={person.id} className="gk-classmate-option">
                        <input type="checkbox" checked={shareWith.includes(person.id)}
                          onChange={() => setShareWith(cur => cur.includes(person.id) ? cur.filter(i => i !== person.id) : [...cur, person.id])} />
                        <span className="gk-classmate-avatar">{person.name.charAt(0)}</span>
                        {person.name}
                      </label>
                    ))
                    : <small>{members.length ? 'No classmates match that name.' : 'No other students yet.'}</small>
                  }
                </div>
              )}
            </div>
          )}
          <div className="gk-upload-submit">
            <button className="gk-btn gk-btn-primary" disabled={uploading || (space !== 'personal' && membership?.role === 'student' && visibility === 'selected' && !shareWith.length)}>
              {uploading ? 'Uploading…' : 'Start upload'}
            </button>
            <button type="button" className="gk-btn gk-btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        </form>
      )}

      {message && <div className="gk-notice gk-notice-bar">{message}</div>}
      {uploadProgress!==null&&<div style={{margin:'8px 0'}}><progress value={uploadProgress} max={100} /> {uploadProgress}%</div>}
      {error && <p className="gk-error">{error} <button className="gk-text-btn" onClick={refresh}>Retry</button></p>}

      <label className="gk-toggle">
        <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
      </label>

      <div className="gk-table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Format</th><th>Size</th><th>Versions</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {busy
              ? <tr><td colSpan={6}><div className="gk-loading-inline"><div className="gk-spinner" /><span>Loading…</span></div></td></tr>
              : files.length
                ? files.map(f => {
                  const latest = f.versions?.[0];
                  return (
                    <tr key={f.id}>
                      <td><Link to={`/files/${f.id}`} className="gk-file-link">{f.name}</Link></td>
                      <td><span className="gk-format-badge">{f.format}</span></td>
                      <td className="numeric">{latest ? `${(Number(latest.size_bytes) / 1024).toFixed(1)} KB` : '—'}</td>
                      <td className="numeric">{f.versions?.length || 0}</td>
                      <td><span className={`gk-badge ${latest?.status}`}>{ingestionLabel(latest)}</span></td>
                      <td><Link to={`/files/${f.id}`} className="gk-btn gk-btn-ghost gk-btn-sm">{Icon.eye} View</Link></td>
                    </tr>
                  );
                })
                : <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '32px' }}>No files yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QuizViewer({ token, fileId, quiz }: { token:string; fileId:string; quiz:any }) {
  const [answers,setAnswers]=useState<Record<number,number>>({}),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{setResult(await request(`/quizzes/${fileId}/attempts`,token,{method:'POST',body:JSON.stringify({answers:Object.entries(answers).map(([questionIndex,selectedIndex])=>({questionIndex:Number(questionIndex),selectedIndex}))})}));}catch(err){setError(err instanceof Error?err.message:'Could not submit quiz.');}finally{setBusy(false);}}
  return <form onSubmit={submit}><h2>{quiz.title||'Study quiz'}</h2>{(quiz.questions||[]).map((question:any,index:number)=><section className="gk-stat-card" style={{marginBottom:12}} key={index}><strong>{index+1}. {question.question}</strong>{question.options.map((option:string,choice:number)=><label key={choice} style={{display:'block',padding:'6px 0'}}><input type="radio" name={`q-${index}`} checked={answers[index]===choice} disabled={!!result} onChange={()=>setAnswers(a=>({...a,[index]:choice}))}/> {option}</label>)}{result&&(()=>{const graded=result.answers.find((a:any)=>a.questionIndex===index);return <p className="gk-hint">{graded?.isCorrect?'Correct.':`Correct answer: ${question.options[graded?.correctIndex]}.`} {graded?.explanation}</p>;})()}</section>)}{error&&<p className="gk-error">{error}</p>}{result?<p className="gk-notice">Score: {result.score} / {result.total}</p>:<button className="gk-btn gk-btn-primary" disabled={busy||Object.keys(answers).length!==quiz.questions.length}>{busy?'Submitting…':'Submit quiz'}</button>}</form>;
}

function AnnotationPanel({token,fileId,versionId,units,format,classroom}:{token:string;fileId:string;versionId:string;units:any[];format:string;classroom:boolean}){
  const [annotations,setAnnotations]=useState<any[]>([]),[filter,setFilter]=useState('all'),[locator,setLocator]=useState(''),[body,setBody]=useState(''),[quote,setQuote]=useState(''),[visibility,setVisibility]=useState<'private'|'class'>('private'),[replyParent,setReplyParent]=useState(''),[error,setError]=useState('');
  const refresh=useCallback(()=>request(`/files/${fileId}/versions/${versionId}/annotations?filter=${filter}`,token).then(d=>setAnnotations(d.annotations||[])).catch(e=>setError(e.message)),[fileId,versionId,filter,token]);
  useEffect(()=>{void refresh();},[refresh]);
  async function submit(e:React.FormEvent){e.preventDefault();try{await request(`/files/${fileId}/versions/${versionId}/annotations`,token,{method:'POST',body:JSON.stringify({locator,body,quote:quote||undefined,visibility,parentId:replyParent||undefined})});setBody('');setQuote('');setReplyParent('');await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not save annotation.');}}
  async function resolve(id:string,resolved:boolean){try{await request(`/annotations/${id}/resolve`,token,{method:'POST',body:JSON.stringify({resolved})});refresh();}catch(e){setError(e instanceof Error?e.message:'Could not update annotation.');}}
  const locatorOf=(a:any)=>a.mapped_locator||a.locator;
  return <section className="gk-stat-card" style={{marginTop:16}}><h2>Section notes</h2><div className="gk-picker-actions"><label>Filter <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All</option><option value="mine">Mine</option><option value="unresolved">Unresolved</option></select></label></div>
    {units.length>0?<div className="gk-picker-actions" style={{margin:'10px 0',flexWrap:'wrap'}}>{units.map((unit:any)=><button type="button" className="gk-btn gk-btn-ghost gk-btn-sm" key={unit.locator} onClick={()=>setLocator(unit.locator)}>{unit.locator} · {annotations.filter(a=>locatorOf(a)===unit.locator).length}</button>)}</div>:<div className="gk-field"><label>PDF page locator<input value={locator} onChange={e=>setLocator(e.target.value)} placeholder="Page 1" /></label></div>}
    <form onSubmit={submit}><div className="gk-field"><label>{replyParent?'Reply':'Add a note'}<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={2000} required /></label></div><div className="gk-field"><label>Quoted text (optional)<input value={quote} onChange={e=>setQuote(e.target.value)} maxLength={300}/></label></div>{classroom&&<div className="gk-field"><label>Visibility<select value={visibility} onChange={e=>setVisibility(e.target.value as 'private'|'class')}><option value="private">Private</option><option value="class">Visible to class</option></select></label></div>}<button className="gk-btn gk-btn-primary" disabled={!locator.trim()||!body.trim()}>{replyParent?'Post reply':'Add note'}</button>{replyParent&&<button type="button" className="gk-btn gk-btn-ghost" onClick={()=>setReplyParent('')}>Cancel reply</button>}</form>
    {error&&<p className="gk-error">{error}</p>}{annotations.map(a=><article className="gk-result-card" key={`${a.id}-${a.version_id}`} style={{opacity:a.outdated?0.55:1}}><strong>{locatorOf(a)}{a.outdated?' · this section changed':''}</strong><p>{a.body}</p>{a.quote&&<blockquote>{a.quote}</blockquote>}<small>{a.visibility} · {a.resolved?'resolved':'open'}</small><div className="gk-picker-actions"><button className="gk-text-btn" onClick={()=>{setReplyParent(a.id);setLocator(locatorOf(a));}}>Reply</button><button className="gk-text-btn" onClick={()=>void resolve(a.id,!a.resolved)}>{a.resolved?'Reopen':'Resolve'}</button></div></article>)}
  </section>;
}

// ─── FILE PAGE (in-app viewer + AI) ──────────────────────────────────────────
function FilePage({ token }: { token: string }) {
  const { id } = useParams();
  const [file, setFile] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [failedJob, setFailedJob] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFile(null); setPreview(null); setError(''); setFailedJob(null); setProcessing(true);
    (async () => {
      try {
        for (;;) {
          const detail = await request(`/files/${id}`, token);
          detail.versions = await Promise.all((detail.versions || []).map(async (v: any) => {
            try { return { ...v, ...(await request(`/files/${id}/versions/${v.id}/job`, token)) }; }
            catch { return v; }
          }));
          if (cancelled) return;
          setFile(detail);
          const current = detail.versions.find((v: any) => v.current);
          if (current?.status === 'failed' || current?.status === 'dead') {
            setFailedJob(current); setError(current.job_error || 'File processing failed.'); return;
          }
          if (current?.status === 'ready') {
          if ((detail.file||detail).format==='quiz') { const data=await request(`/files/${id}/quiz`,token); if(!cancelled)setPreview({format:'quiz',fileName:(detail.file||detail).name,quiz:data.quiz}); return; }
          try {
            const view = await request(`/files/${id}/preview`, token);
            if (!cancelled) setPreview(view);
            return;
          } catch (e) {
            if (!(e instanceof Error) || !e.message.toLowerCase().includes('processing')) throw e;
          }
          }
          await new Promise(r => setTimeout(r, 3000));
          if (cancelled) return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this file.');
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token, refreshKey]);

  async function retryVersion(versionId: string) {
    if (!id) return;
    try { await request(`/files/${id}/versions/${versionId}/retry`, token, { method: 'POST' }); setError(''); setFailedJob(null); setPreview(null); setProcessing(true); setRefreshKey(x => x + 1); }
    catch (e) { setError(e instanceof Error ? e.message : 'Retry failed.'); }
  }

  if (error) return <div className="gk-page"><div className="gk-error">{error}</div>{failedJob && <button className="gk-btn gk-btn-primary" onClick={() => retryVersion(failedJob.id)}>Retry processing</button>}</div>;
  if (!file || !preview) return (
    <div className="gk-page gk-center">
      <div className="gk-spinner" />
      <p>{processing ? 'Preparing your in-app file viewer…' : 'Loading file…'}</p>
      <small>The original stays in the classroom — no download needed.</small>
    </div>
  );

  const f = file.file || file;
  const versions = file.versions || [];
  const currentVersion = versions.find((v:any)=>v.current);
  const back = f.owner_type === 'org' ? `/classroom/${f.owner_id}` : '/spaces/personal';

  return (
    <div className="gk-page gk-file-page">
      <div className="gk-file-header">
        <Link className="gk-back-link" to={back}>{Icon.back} Back to classroom</Link>
        <div className="gk-file-title-row">
          <div>
            <h1>{f.name}</h1>
            <p>{f.format.toUpperCase()} · version {preview.versionNo}</p>
          </div>
          <Link className="gk-btn gk-btn-primary" to={`/assistant?fileId=${f.id}`}>{Icon.ai} Study with AI</Link>
        </div>
      </div>

      <div className="gk-document-viewer">
        {preview.format === 'quiz'
          ? <QuizViewer token={token} fileId={id!} quiz={preview.quiz} />
          : preview.format === 'pdf'
          ? <iframe
              title={`Preview of ${preview.fileName}`}
              src={preview.url}
            />
          : (
            <div className={preview.format === 'pptx' ? 'gk-slide-list' : 'gk-document-text'}>
              {preview.units?.length
                ? preview.units.map((unit: any, i: number) => (
                  <article className={preview.format === 'pptx' ? 'gk-slide-card' : 'gk-para-card'} key={`${unit.locator}-${i}`}>
                    <span className="gk-unit-label">{unit.locator}</span>
                    <p>{unit.text}</p>
                  </article>
                ))
                : <p className="gk-hint">No extractable text to show.</p>
              }
            </div>
          )
        }
      </div>
      {currentVersion && <AnnotationPanel token={token} fileId={f.id} versionId={currentVersion.id} units={preview.units||[]} format={preview.format} classroom={f.owner_type==='org'} />}

      {versions.length > 0 && (
        <details className="gk-versions-details">
          <summary>Version history ({versions.length})</summary>
          <div className="gk-table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Version</th><th>Date</th><th>Uploader</th><th>Size</th><th>Status</th></tr></thead>
              <tbody>
                {versions.map((v: any) => (
                  <tr key={v.id}>
                    <td>v{v.version_no}{v.current ? ' · Current' : ''}</td>
                    <td>{new Date(v.created_at).toLocaleString()}</td>
                    <td>{v.uploader}</td>
                    <td>{Number(v.size_bytes).toLocaleString()} B</td>
                    <td><span className={`gk-badge ${v.status}`}>{v.job_status === 'queued' ? 'queued' : v.job_status === 'running' ? 'processing' : v.job_status === 'dead' ? 'failed' : v.status}</span>{v.job_status && !['succeeded','dead'].includes(v.job_status) && <small> · attempt {v.job_attempts} of {v.job_max_attempts}</small>}{v.job_status === 'dead' && <button className="gk-btn gk-btn-ghost gk-btn-sm" style={{ marginLeft: 8 }} onClick={() => retryVersion(v.id)}>Retry</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

// ─── SEARCH PAGE ──────────────────────────────────────────────────────────────
function highlightQuery(text: string, query: string) {
  const terms=query.trim().split(/\s+/).filter(Boolean);if(!terms.length)return text;
  const escaped=terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const regex=new RegExp(`(${escaped.join('|')})`,'gi');
  return text.split(regex).map((part,index)=>terms.some(term=>term.toLowerCase()===part.toLowerCase())?<mark key={index}>{part}</mark>:part);
}

function SearchPage({ token }: { token: string }) {
  const [q, setQ] = useState(''), [name, setName] = useState('');
  const [mode, setMode] = useState<'hybrid'|'semantic'|'keyword'>('hybrid'), [degraded, setDegraded] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (name.trim()) params.set('name', name.trim());
      params.set('mode', mode);
      const d = await request(`/search?${params}`, token);
      setResults(d.results || []); setDegraded(Boolean(d.degraded));
    } catch (err) { setError(err instanceof Error ? err.message : 'Search failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="gk-page">
      <div className="gk-page-header"><div><h1>Search</h1><p>Search document content by meaning or by file name.</p></div></div>
      <form className="gk-search-form" onSubmit={submit}>
        <div className="gk-field"><label>Search mode</label><div className="gk-picker-actions">{(['hybrid','semantic','keyword'] as const).map(value=><button type="button" key={value} className={`gk-btn gk-btn-sm ${mode===value?'gk-btn-primary':'gk-btn-ghost'}`} onClick={()=>setMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div></div>
        <div className="gk-field"><label>Content search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search across your documents…" /></label></div>
        <div className="gk-field"><label>File name<input value={name} onChange={e => setName(e.target.value)} placeholder="Filter by name" /></label></div>
        <button className="gk-btn gk-btn-primary" disabled={busy}>{busy ? 'Searching…' : `${Icon.search} Search`}</button>
      </form>
      {degraded && <p className="gk-hint">Vector search is temporarily unavailable; showing keyword results.</p>}
      {error && <p className="gk-error">{error}</p>}
      {!results.length && !busy
        ? <div className="gk-empty-state"><p>Enter a query to search your documents.</p></div>
        : results.map((r: any) => (
          <article key={r.unit_id || r.file_id} className="gk-result-card">
            <Link to={`/files/${r.file_id}?unit=${encodeURIComponent(r.locator || '')}`} className="gk-result-title">{r.file_name || r.name}</Link>
            <span className="gk-result-meta">{r.locator} · {Number(r.score || 0).toFixed(3)} · matched by {r.signals?.join(' + ') || 'filename'}</span>
            <p className="gk-result-snippet">{highlightQuery(r.snippet || r.text?.slice(0, 240) || '',q)}</p>
          </article>
        ))
      }
    </div>
  );
}

// ─── ASSISTANT PAGE ───────────────────────────────────────────────────────────
function AssistantPage({ token }: { token: string }) {
  const [library, setLibrary] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const requestedFileId = searchParams.get('fileId');
  const requestedClassId = searchParams.get('classId');

  useEffect(() => {
    request('/assistant/library', token).then(d => {
      const files: any[] = d.files || [];
      setLibrary(files);
      if (requestedFileId) {
        setSelected([requestedFileId]);
      } else if (requestedClassId) {
        const classFiles = files.filter((f: any) => f.owner_id === requestedClassId && f.available);
        setSelected(classFiles.length ? classFiles.map((f: any) => f.id) : files.filter((f: any) => f.available).map((f: any) => f.id));
      } else {
        setSelected(files.filter((f: any) => f.available).map((f: any) => f.id));
      }
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token, requestedFileId, requestedClassId]);

  useEffect(() => {
    if (!library.some(f => !f.available && (f.status === 'processing' || !f.status))) return;
    const timer = setInterval(() => { request('/assistant/library', token).then(d => setLibrary(d.files || [])).catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [library, token]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const available = library.filter(f => f.available);

  function toggle(id: string) { setSelected(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]); }

  async function askQuestion(askedQuestion: string) {
    const asked = askedQuestion.trim();
    if (!asked) return;
    if (!selected.length) { setError('Choose at least one ready file so the assistant has material to study.'); return; }
    const prior = messages.slice(-8).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.text }));
    setBusy(true); setError(''); setQuestion('');
    setMessages(cur => [...cur, { role: 'user', text: asked }]);
    try {
      const d = await request('/assistant/ask', token, { method: 'POST', body: JSON.stringify({ question: asked, fileIds: selected, history: prior }) });
      setMessages(cur => [...cur, { role: 'assistant', text: d.answer, sources: d.sources || [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get an answer.');
      setQuestion(asked);
    } finally { setBusy(false); }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    await askQuestion(question);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e as any); }
  }

  return (
    <div className="gk-page gk-assistant-page">
      <div className="gk-page-header">
        <div><h1>{Icon.ai} AI Study Assistant</h1><p>Ask questions about your indexed files. Sources are retrieved directly — no re-upload needed.</p></div>
        <button className="gk-btn gk-btn-ghost" onClick={() => setMessages([])} disabled={!messages.length}>New chat</button>
      </div>

      <div className="gk-assistant-layout">
        {/* Source picker */}
        <aside className="gk-source-picker">
          <div className="gk-picker-head">
            <strong>Study sources</strong>
            <span>{selected.length} selected</span>
          </div>
          {loading
            ? <p className="gk-hint">Loading your file library…</p>
            : !available.length
              ? <div className="gk-empty-state gk-empty-inline">No indexed documents yet. Upload and wait for processing.</div>
              : (
                <>
                  <div className="gk-picker-actions">
                    <button type="button" className="gk-text-btn" onClick={() => setSelected(available.map(f => f.id))}>Select all</button>
                    <button type="button" className="gk-text-btn" onClick={() => setSelected([])}>Clear</button>
                  </div>
                  <div className="gk-source-list">
                    {library.map((f: any) => (
                      <label className={`gk-source-option${f.available ? '' : ' unavailable'}`} key={f.id}>
                        <input type="checkbox" checked={selected.includes(f.id)} disabled={!f.available} onChange={() => toggle(f.id)} />
                        <span>
                          <strong>{f.name}</strong>
                          <small>{f.course_code ? `${f.course_code} · ${f.course_name}` : 'Personal'} · {f.available ? `${f.searchable_units || 0} sections` : f.readiness || f.status || 'Not indexed'}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="gk-hint" style={{ marginTop: 10 }}>Only indexed files you can access are used.</p>
                </>
              )
          }
        </aside>

        {/* Chat panel */}
        <div className="gk-chat-panel">
          <div className="gk-chat-history">
            {!messages.length
              ? (
                <div className="gk-chat-welcome">
                  <div className="gk-assistant-avatar">G</div>
                  <h2>What are you studying today?</h2>
                  <p>Select source files, then ask for an explanation, summary, comparison, or quiz. Every answer links back to its source.</p>
                  <div className="gk-suggested-prompts">
                    {['Explain the main ideas', 'Summarize key points', 'Make me a study plan', 'Give me 5 practice questions'].map(p => (
                      <button key={p} className="gk-btn gk-btn-ghost gk-btn-sm" onClick={() => askQuestion(p)}>{p}</button>
                    ))}
                  </div>
                </div>
              )
              : messages.map((m, i) => (
                <article className={`gk-chat-msg${m.role === 'user' ? ' user' : ' assistant'}`} key={i}>
                  <div className="gk-msg-header">
                    {m.role === 'assistant' && <span className="gk-msg-avatar">G</span>}
                    <strong>{m.role === 'user' ? 'You' : 'Gurukul-AI'}</strong>
                  </div>
                  <div className="gk-msg-text">{m.text}</div>
                  {m.sources?.length > 0 && (
                    <div className="gk-chat-sources">
                      <strong>Sources</strong>
                      {m.sources.map((src: any, n: number) => (
                        <Link key={`${src.fileId}-${src.locator}-${n}`} to={`/files/${src.fileId}?unit=${encodeURIComponent(src.locator || '')}`} className="gk-source-cite">
                          <span>[{n + 1}] {src.fileName} · {src.locator}</span>
                          <small>{src.snippet}</small>
                        </Link>
                      ))}
                    </div>
                  )}
                </article>
              ))
            }
            {busy && (
              <div className="gk-chat-msg assistant gk-thinking">
                <div className="gk-msg-header"><span className="gk-msg-avatar">G</span><strong>Gurukul-AI</strong></div>
                <div className="gk-thinking-dots"><span /><span /><span /></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form className="gk-chat-composer" onSubmit={ask}>
            <textarea
              id="assistant-question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={available.length ? 'Ask about your selected files… (Enter to send, Shift+Enter for new line)' : 'Select files to begin'}
              rows={3}
              disabled={busy || !available.length}
            />
            <div className="gk-composer-footer">
              <span>{selected.length ? `Searching ${selected.length} file${selected.length === 1 ? '' : 's'}` : 'Select files to begin'}</span>
              <button className="gk-btn gk-btn-primary" disabled={busy || !selected.length || !question.trim()}>
                {busy ? 'Thinking…' : `${Icon.send} Ask`}
              </button>
            </div>
          </form>
          {error && <p className="gk-error" role="alert" style={{ margin: '8px 12px' }}>{error}</p>}
        </div>
      </div>
    </div>
  );
}

function StudyPage({token}:{token:string}){
  const [items,setItems]=useState<any[]>([]),[attempts,setAttempts]=useState<any[]>([]),[topics,setTopics]=useState<any[]>([]),[selected,setSelected]=useState<number|null>(null),[answer,setAnswer]=useState<any>(null),[error,setError]=useState('');
  const refresh=useCallback(async()=>{try{const [q,a,w]=await Promise.all([request('/study/review-queue',token),request('/study/attempts',token),request('/study/weak-topics',token)]);setItems(q.items||[]);setAttempts(a.attempts||[]);setTopics(w.topics||[]);}catch(e){setError(e instanceof Error?e.message:'Could not load study data.');}},[token]);
  useEffect(()=>{void refresh();},[refresh]);
  const current=items[0];
  async function submit(){if(!current||selected===null)return;try{setAnswer(await request(`/study/review-queue/${current.id}/answer`,token,{method:'POST',body:JSON.stringify({selectedIndex:selected})}));}catch(e){setError(e instanceof Error?e.message:'Could not submit answer.');}}
  return <div className="gk-page"><div className="gk-page-header"><div><h1>Study</h1><p>{items.length} question{items.length===1?'':'s'} due for review.</p></div></div>{error&&<p className="gk-error">{error}</p>}<section className="gk-stat-card"><h2>Review queue</h2>{!current?<p className="gk-hint">You are all caught up.</p>:<><p><strong>{current.quizName}</strong> · Box {current.box}</p><h3>{current.question}</h3>{current.options.map((option:string,i:number)=><label key={i} style={{display:'block',padding:'8px 0'}}><input type="radio" name="review-answer" disabled={!!answer} checked={selected===i} onChange={()=>setSelected(i)}/> {option}</label>)}{answer?<><p className="gk-hint">{answer.correct?'Correct.':`Correct answer: ${current.options[answer.correctIndex]}.`} {answer.explanation}</p><button className="gk-btn gk-btn-primary" onClick={()=>{setItems(x=>x.slice(1));setAnswer(null);setSelected(null);}}>Next question</button></>:<button className="gk-btn gk-btn-primary" disabled={selected===null} onClick={()=>void submit()}>Check answer</button>}</>}</section><section className="gk-stat-card" style={{marginTop:16}}><h2>Weak topics</h2><p className="gk-hint">Grouped by quiz because generated questions do not keep source file identifiers.</p>{topics.map((topic:any)=><p key={topic.quiz_file_id}><Link to={`/files/${topic.quiz_file_id}`}>{topic.quiz_name}</Link> · {topic.misses} missed answers</p>)}{!topics.length&&<p className="gk-hint">No misses recorded yet.</p>}</section><section className="gk-stat-card" style={{marginTop:16}}><h2>Attempt history</h2><div className="gk-table-wrap"><table><thead><tr><th>Quiz</th><th>Score</th><th>Date</th></tr></thead><tbody>{attempts.map((a:any)=><tr key={a.id}><td>{a.quiz_name}</td><td>{a.score}/{a.total}</td><td>{new Date(a.created_at).toLocaleString()}</td></tr>)}{!attempts.length&&<tr><td colSpan={3}>No attempts yet.</td></tr>}</tbody></table></div></section></div>;
}

// ─── DASHBOARD PAGE (in-app viewer + AI) ─────────────────────────────────────
function DashboardPage({ token, isProfessor }: { token: string; isProfessor: boolean }) {
  const [stats, setStats] = useState<any>(null), [error, setError] = useState('');
  const [pipeline, setPipeline] = useState<any>(null), pipelineRef = useRef<HTMLDivElement | null>(null), [pipelineVisible, setPipelineVisible] = useState(false);
  useEffect(() => { request('/stats', token).then(setStats).catch(e => setError(e.message)); }, [token]);
  useEffect(() => { if (!isProfessor || !pipelineRef.current) return; const observer = new IntersectionObserver(entries => setPipelineVisible(entries.some(entry => entry.isIntersecting))); observer.observe(pipelineRef.current); return () => observer.disconnect(); }, [isProfessor]);
  useEffect(() => { if (!isProfessor || !pipelineVisible) return; const load = () => request('/ops/metrics', token).then(setPipeline).catch(() => {}); load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [isProfessor, pipelineVisible, token]);
  if (error) return <div className="gk-page"><p className="gk-error">{error}</p></div>;
  if (!stats) return <div className="gk-page gk-center"><div className="gk-spinner" /></div>;
  const rows: [string, string, string][] = [
    ['Files', 'files', 'Files visible in your personal and course spaces.'],
    ['Versions', 'versions', 'Uploaded and generated versions.'],
    ['Logical bytes', 'logicalBytes', 'Total size across visible versions.'],
    ['Stored bytes', 'storedBytes', 'Storage used by distinct blobs.'],
    ['Dedup savings', 'exactDedupSavedBytes', 'Bytes saved by exact file deduplication.'],
    ['Text units', 'unitsTotal', 'Parsed paragraphs, slides, and pages.'],
    ['Distinct units', 'unitsDistinct', 'Unique normalized text units.'],
    ['Similar files', 'nearDuplicates', 'Similarity flags belonging to you.'],
  ];
  return (
    <div className="gk-page">
      <div className="gk-page-header"><div><h1>Dashboard</h1><p>Storage and content stats for your accessible files.</p></div></div>
      <div className="gk-stats-grid">
        {rows.map(([label, key, desc]) => (
          <div key={key} className="gk-stat-card">
            <div className="gk-stat-value">{Number(stats[key] || 0).toLocaleString()}</div>
            <div className="gk-stat-label">{label}</div>
            <div className="gk-stat-desc">{desc}</div>
          </div>
        ))}
      </div>
      <section className="gk-stat-card" style={{ marginTop: 18 }}>
        <div className="gk-stat-label">Storage cost · simulated using configurable rates</div>
        <div className="gk-stat-desc">Monthly estimate: naive ${Number(stats.storageCost?.naiveMonthlyUsd || 0).toFixed(4)} · with dedup ${Number(stats.storageCost?.dedupMonthlyUsd || 0).toFixed(4)} · with dedup + simulated tiering ${Number(stats.storageCost?.tieredMonthlyUsd || 0).toFixed(4)}. Estimated savings {Number(stats.storageCost?.savingsPercent || 0).toFixed(1)}%.</div>
        <div className="gk-stat-desc" style={{ marginTop: 8 }}>Upload bandwidth saved before transfer: {Number(stats.uploadBandwidth?.bytesSaved || 0).toLocaleString()} bytes across {Number(stats.uploadBandwidth?.dedupedUploads || 0)} duplicate uploads; direct uploads transferred {Number(stats.uploadBandwidth?.directBytes || 0).toLocaleString()} bytes.</div>
      </section>
      {isProfessor && <section ref={pipelineRef} className="gk-stat-card" style={{ marginTop: 18 }}>
        <div className="gk-stat-label">Pipeline health</div>
        {!pipeline ? <p className="gk-hint">Loading ingestion metrics…</p> : <>
          <div className="gk-stat-desc">Queue: queued {pipeline.queue?.queued || 0} · running {pipeline.queue?.running || 0} · dead {pipeline.queue?.dead || 0} · p50/p95 {pipeline.durationMs?.p50 ?? '—'} / {pipeline.durationMs?.p95 ?? '—'} ms · failure rate {(Number(pipeline.failureRate || 0) * 100).toFixed(1)}%</div>
          <div className="gk-table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>File</th><th>Status</th><th>Attempts</th><th>Duration</th></tr></thead><tbody>{(pipeline.recentJobs || []).map((job: any) => <tr key={job.id}><td>{job.file_name || 'Restricted file'}</td><td>{job.status}</td><td>{job.attempts}/{job.max_attempts}</td><td>{job.duration_ms ?? '—'} ms</td></tr>)}</tbody></table></div>
        </>}
      </section>}
    </div>
  );
}

// ─── TRASH PAGE ───────────────────────────────────────────────────────────────
function TrashPage({ token }: { token: string }) {
  const [files, setFiles] = useState<FileRow[]>([]), [error, setError] = useState('');
  const refresh = useCallback(() => { request('/trash', token).then(d => setFiles(d.files || [])).catch(e => setError(e.message)); }, [token]);
  useEffect(() => refresh(), [refresh]);
  async function restore(id: string) { try { await request(`/files/${id}/restore`, token, { method: 'POST' }); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Restore failed.'); } }
  return (
    <div className="gk-page">
      <div className="gk-page-header"><div><h1>{Icon.trash} Trash</h1><p>Deleted files can be restored during the retention period.</p></div></div>
      {error && <p className="gk-error">{error}</p>}
      <div className="gk-table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Deleted</th><th>Days left</th><th></th></tr></thead>
          <tbody>
            {files.length
              ? files.map((f: any) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.deleted_at ? new Date(f.deleted_at).toLocaleDateString() : '—'}</td>
                  <td className="numeric">{f.daysLeft ?? '—'}</td>
                  <td><button className="gk-btn gk-btn-ghost gk-btn-sm" onClick={() => restore(f.id)}>Restore</button></td>
                </tr>
              ))
              : <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>Trash is empty.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>
);
