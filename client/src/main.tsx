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
type FileRow = { id: string; name: string; format: string; visibility: string; created_at?: string; versions?: { id: string; version_no: number; status: string; size_bytes: number }[]; archived_at?: string | null };
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
      : [{ label: 'Home', href: '/student', icon: Icon.home }, { label: 'My Files', href: '/spaces/personal', icon: Icon.files }, { label: 'AI Assistant', href: '/assistant', icon: Icon.ai }, { label: 'Search', href: '/search', icon: Icon.search }, { label: 'Dashboard', href: '/dashboard', icon: Icon.dashboard }];

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
          <Route path="/dashboard" element={<DashboardPage token={auth.token} />} />
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
  const [tab, setTab] = useState<'stream' | 'materials' | 'members'>('stream');
  const [classroom, setClassroom] = useState<any>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false), [uploadMsg, setUploadMsg] = useState('');
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
    if (membership?.role === 'student' && visibility === 'selected' && !shareWith.length) {
      setError('Choose at least one classmate to share with, or share with everyone.');
      return;
    }
    setUploading(true); setError(''); setUploadMsg('');
    try {
      const data = new FormData();
      data.append('file', selected);
      data.append('scope', `org:${id}`);
      data.append('visibility', visibility);
      data.append('shareWith', JSON.stringify(shareWith));
      const result = await request('/files', token, { method: 'POST', body: data });
      setUploadMsg(result.dedup?.matchedScope === 'shared' ? '✓ File already in course — linked, no extra storage used.' : '✓ Upload started. Processing…');
      setSelected(null); if (fileInputRef.current) fileInputRef.current.value = '';
      setShareWith([]);
      setTimeout(refreshFiles, 2000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setUploading(false); }
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
        {(['stream', 'materials', 'members'] as const).map(t => (
          <button key={t} className={`gk-class-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'stream' ? `${Icon.announce} Stream` : t === 'materials' ? `${Icon.material} Materials` : `${Icon.people} Members`}
          </button>
        ))}
      </div>

      {error && <div className="gk-error gk-error-bar" role="alert" style={{ margin: '0 24px 0' }}>{error} <button className="gk-text-btn" onClick={() => setError('')}>{Icon.close}</button></div>}
      {uploadMsg && <div className="gk-notice gk-notice-bar" style={{ margin: '0 24px 12px' }}>{uploadMsg}</div>}

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
                        <input id="class-file-input" type="file" accept=".docx,.pptx,.pdf" ref={fileInputRef}
                          onChange={e => setSelected(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                        <span className="gk-file-drop-icon">{Icon.upload}</span>
                        <span>Click to upload a PDF, PPTX, or DOCX</span>
                      </label>
                    )
                    : (
                      <div className="gk-selected-file">
                        <span>{Icon.material} {selected.name}</span>
                        <button type="button" className="gk-icon-btn" onClick={() => { setSelected(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>{Icon.close}</button>
                      </div>
                    )
                  }

                  {/* Student selective sharing */}
                  {selected && membership?.role === 'student' && (
                    <div className="gk-share-controls">
                      <label className="gk-field">
                        Share with
                        <select value={visibility} onChange={e => setVisibility(e.target.value as 'classroom' | 'selected')}>
                          <option value="classroom">Everyone in this classroom</option>
                          <option value="selected">Only selected classmates</option>
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
                            : <small>{members.length ? 'No classmates match that name.' : 'No other students in this class yet.'}</small>
                          }
                        </div>
                      )}
                    </div>
                  )}

                  {selected && (
                    <button className="gk-btn gk-btn-primary" disabled={uploading || (membership?.role === 'student' && visibility === 'selected' && !shareWith.length)}>
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
                <input type="file" accept=".docx,.pptx,.pdf" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploading(true); setError(''); setUploadMsg('');
                  try {
                    const data = new FormData();
                    data.append('file', file);
                    data.append('scope', `org:${id}`);
                    data.append('visibility', 'classroom');
                    data.append('shareWith', '[]');
                    await request('/files', token, { method: 'POST', body: data });
                    setUploadMsg('✓ Upload started. Processing…');
                    setTimeout(refreshFiles, 2000);
                  } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
                  finally { setUploading(false); e.target.value = ''; }
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
                            <small>{f.format.toUpperCase()} · {latest ? `${(Number(latest.size_bytes) / 1024).toFixed(1)} KB` : '—'} · <span className={`gk-badge ${latest?.status}`}>{latest?.status || 'Processing'}</span></small>
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
      </div>
    </div>
  );
}

function StreamPost({ file, latest, classroomId }: { file: FileRow; latest: any; classroomId: string }) {
  const isReady = latest?.status === 'ready';
  return (
    <div className="gk-stream-post">
      <div className="gk-post-icon">{file.format === 'pdf' ? '📄' : file.format === 'pptx' ? '📊' : '📝'}</div>
      <div className="gk-post-content">
        <div className="gk-post-meta">
          <span className="gk-post-type">{file.format.toUpperCase()} · {file.visibility === 'classroom' ? 'Everyone' : 'Selected students'}</span>
          <span className={`gk-badge ${latest?.status}`}>{latest?.status || 'Processing'}</span>
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
  const [uploading, setUploading] = useState(false), [message, setMessage] = useState('');
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
      const data = new FormData();
      data.append('file', selected); data.append('scope', scope);
      data.append('visibility', visibility); data.append('shareWith', JSON.stringify(shareWith));
      const result = await request('/files', token, { method: 'POST', body: data });
      setMessage(result.dedup?.matchedScope === 'shared' ? '✓ Matched a course file. No new storage used.' : result.dedup?.matchedScope === 'own' ? '✓ You already stored this file.' : '✓ Upload started.');
      setSelected(null); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Upload failed.'); }
    finally { setUploading(false); }
  }

  const title = space === 'personal' ? 'My personal files' : `${membership?.code || 'Course'} ${membership?.name || ''}`.trim();

  return (
    <div className="gk-page">
      <div className="gk-page-header">
        <div><h1>{title}</h1><p>Documents, versions, and study materials.</p></div>
        {canUpload && (
          <label className="gk-btn gk-btn-primary">
            {Icon.upload} Upload file
            <input type="file" accept=".docx,.pptx,.pdf" style={{ display: 'none' }} onChange={e => setSelected(e.target.files?.[0] || null)} />
          </label>
        )}
      </div>

      {selected && (
        <form className="gk-upload-form" onSubmit={upload}>
          <div className="gk-upload-file-row">
            <span>{Icon.material} {selected.name}</span>
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
                      <td><span className={`gk-badge ${latest?.status}`}>{latest?.status || 'Processing'}</span></td>
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

// ─── FILE PAGE (in-app viewer + AI) ──────────────────────────────────────────
function FilePage({ token }: { token: string }) {
  const { id } = useParams();
  const [file, setFile] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFile(null); setPreview(null); setError(''); setProcessing(true);
    (async () => {
      try {
        const detail = await request(`/files/${id}`, token);
        if (cancelled) return;
        setFile(detail);
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            const view = await request(`/files/${id}/preview`, token);
            if (!cancelled) setPreview(view);
            return;
          } catch (e) {
            if (!(e instanceof Error) || !e.message.toLowerCase().includes('still processing') && !e.message.toLowerCase().includes('processing')) throw e;
            await new Promise(r => setTimeout(r, 1500));
            if (cancelled) return;
          }
        }
        throw new Error('File processing is taking longer than expected. Try again shortly.');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this file.');
      } finally {
        if (!cancelled) setProcessing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  if (error) return <div className="gk-page"><div className="gk-error">{error}</div></div>;
  if (!file || !preview) return (
    <div className="gk-page gk-center">
      <div className="gk-spinner" />
      <p>{processing ? 'Preparing your in-app file viewer…' : 'Loading file…'}</p>
      <small>The original stays in the classroom — no download needed.</small>
    </div>
  );

  const f = file.file || file;
  const versions = file.versions || [];
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
        {preview.format === 'pdf'
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
                    <td><span className={`gk-badge ${v.status}`}>{v.status}</span></td>
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
function SearchPage({ token }: { token: string }) {
  const [q, setQ] = useState(''), [name, setName] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (name.trim()) params.set('name', name.trim());
      const d = await request(`/search?${params}`, token);
      setResults(d.results || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Search failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="gk-page">
      <div className="gk-page-header"><div><h1>Search</h1><p>Search document content by meaning or by file name.</p></div></div>
      <form className="gk-search-form" onSubmit={submit}>
        <div className="gk-field"><label>Content search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search across your documents…" /></label></div>
        <div className="gk-field"><label>File name<input value={name} onChange={e => setName(e.target.value)} placeholder="Filter by name" /></label></div>
        <button className="gk-btn gk-btn-primary" disabled={busy}>{busy ? 'Searching…' : `${Icon.search} Search`}</button>
      </form>
      {error && <p className="gk-error">{error}</p>}
      {!results.length && !busy
        ? <div className="gk-empty-state"><p>Enter a query to search your documents.</p></div>
        : results.map((r: any) => (
          <article key={r.unit_id || r.file_id} className="gk-result-card">
            <Link to={`/files/${r.file_id}?unit=${encodeURIComponent(r.locator || '')}`} className="gk-result-title">{r.file_name || r.name}</Link>
            <span className="gk-result-meta">{r.locator} · {Number(r.score || 0).toFixed(2)}</span>
            <p className="gk-result-snippet">{r.snippet || r.text?.slice(0, 240)}</p>
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

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────
function DashboardPage({ token }: { token: string }) {
  const [stats, setStats] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { request('/stats', token).then(setStats).catch(e => setError(e.message)); }, [token]);
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
