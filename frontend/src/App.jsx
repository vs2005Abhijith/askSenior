import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, firebaseConfigured, googleProvider } from './firebase';
import './App.css';

function AuthScreen() {
  const [error, setError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (signInError) {
      if (signInError.code !== 'auth/popup-closed-by-user') {
        const errorMessages = {
          'auth/unauthorized-domain': 'Add this Vercel domain in Firebase Authentication > Settings > Authorized domains.',
          'auth/popup-blocked': 'Allow popups for this site, then try Google sign-in again.',
          'auth/operation-not-allowed': 'Enable Google as a sign-in provider in Firebase Authentication.',
          'auth/network-request-failed': 'Check your internet connection and try again.',
        };
        setError(errorMessages[signInError.code] || 'Google sign-in could not be completed. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <main className="auth-container">
      <section className="auth-card">
        <div className="auth-header">
          <img className="auth-logo" src="/asksenior-logo.jpeg" alt="askSenior" />
          <p>KTU B.Tech CSE Syllabus Assistant</p>
        </div>
        {!firebaseConfigured ? (
          <div className="auth-error">
            Google sign-in is not configured yet. Add the Firebase Vercel environment variables to continue.
          </div>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            <button className="google-signin" onClick={handleGoogleSignIn} disabled={isSigningIn}>
              <span className="google-mark">G</span>
              {isSigningIn ? 'Opening Google...' : 'Continue with Google'}
            </button>
            <p className="auth-footer">Sign in to keep your study space personal.</p>
          </>
        )}
      </section>
    </main>
  );
}

function AboutPage() {
  return (
    <main className="about-page">
      <header className="about-header">
        <a className="about-logo-link" href="/" aria-label="Go to askSenior home">
          <img className="about-logo" src="/asksenior-logo.jpeg" alt="askSenior" />
        </a>
        <a className="text-btn about-home-link" href="/">Back to askSenior</a>
      </header>
      <section className="about-card">
        <div className="about-intro">
          <img className="about-profile-photo" src="/abhijith-profile.jpg" alt="Abhijith V S" />
          <div>
            <p className="eyebrow"> behind askSenior</p>
            <h2>Hi, I&apos;m Abhijith V S.</h2>
            <p className="about-lead">
              I&apos;m a 3rd year CSE student at RIT Kottayam and the creator of askSenior, a study companion built to make KTU syllabus preparation more focused and accessible.
            </p>
          </div>
        </div>
        <div className="about-grid">
          <article className="about-detail">
            <span className="about-detail-number">01</span>
            <h2>Why askSenior?</h2>
            <p>It turns syllabus-based notes into a simple place to ask questions, revise concepts, and practise with generated quizzes.</p>
          </article>
          <article className="about-detail">
            <span className="about-detail-number">02</span>
            <h2>Current focus</h2>
            <p>The app currently supports selected KTU topics from TOC, DBMS, OS Disk Scheduling, and Computer Networks.</p>
          </article>
        </div>
        <div className="about-contact">
          <div>
            <span className="about-contact-label">Connect with me</span>
            <strong>Let&apos;s keep learning and building.</strong>
          </div>
          <div className="about-contact-links">
            <a href="https://portfolio-olff.onrender.com/" target="_blank" rel="noreferrer">Portfolio</a>
            <a href="https://www.linkedin.com/in/abhijith-v-s-98b326314" target="_blank" rel="noreferrer">
              <svg className="linkedin-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M5.2 7.2A2.2 2.2 0 1 0 5.2 2.8a2.2 2.2 0 0 0 0 4.4ZM3.3 21.2h3.8V9.1H3.3v12.1ZM9.5 9.1v12.1h3.8v-6c0-1.6.3-3.2 2.3-3.2 1.9 0 1.9 1.9 1.9 3.3v5.9h3.8v-6.7c0-3.3-.7-5.8-4.7-5.8-1.9 0-3.2 1-3.7 2h-.1V9.1H9.5Z" />
              </svg>
              LinkedIn
            </a>
            <a href="mailto:vsabhijithin17@gmail.com">vsabhijithin17@gmail.com</a>
          </div>
        </div>
      </section>
    </main>
  );
}

function AdminDashboard() {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('askSeniorAdminKey') || '');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('askSeniorLatestJob') || 'null');
    } catch {
      return null;
    }
  });
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (job) localStorage.setItem('askSeniorLatestJob', JSON.stringify(job));
  }, [job]);

  useEffect(() => {
    if (job || !adminKey) return undefined;

    fetch(`${apiBaseUrl}/admin/ingest/latest`, {
      headers: { 'X-Admin-Key': adminKey },
    })
      .then((response) => {
        if (!response.ok) throw new Error('Could not restore ingestion status.');
        return response.json();
      })
      .then(setJob)
      .catch((statusError) => setError(statusError.message));

    return undefined;
  }, [apiBaseUrl, adminKey, job]);

  useEffect(() => {
    if (!job || ['completed', 'failed'].includes(job.status)) return undefined;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/admin/ingest/${job.job_id}`, {
          headers: { 'X-Admin-Key': adminKey },
        });
        if (!response.ok) throw new Error('Could not read ingestion status.');
        setJob(await response.json());
      } catch (statusError) {
        setError(statusError.message);
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [apiBaseUrl, adminKey, job]);

  const handleUpload = async (event) => {
    event.preventDefault();
    if (!file || !adminKey.trim()) {
      setError('Select a PDF and enter the admin key.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('This Vercel deployment accepts PDFs up to 4 MB. Compress or split the PDF first.');
      return;
    }

    setError('');
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${apiBaseUrl}/admin/ingest`, {
        method: 'POST',
        headers: { 'X-Admin-Key': adminKey.trim() },
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Upload failed.');
      setJob(data);
      setFile(null);
      event.target.reset();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setIsUploading(false);
    }
  };

  const progress = job?.total_chunks
    ? Math.round((job.completed_chunks / job.total_chunks) * 100)
    : 0;

  return (
    <div className="admin-shell">
      <div className="admin-card">
        <div className="admin-topbar">
          <div>
            <p className="eyebrow">askSenior / control room</p>
            <h1>Knowledge base</h1>
            <p className="admin-subtitle">Add trusted KTU notes to the assistant.</p>
          </div>
          <button className="text-btn" onClick={() => { window.location.href = '/'; }}>
            Back to chat
          </button>
        </div>

        <form className="upload-panel" onSubmit={handleUpload}>
          <div className="upload-copy">
            <span className="upload-kicker">01 / source material</span>
            <h2>Upload a PDF</h2>
            <p>It will be extracted, chunked, embedded, and added to Pinecone in the background.</p>
          </div>
          <label className="file-drop">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
            <span className="file-icon">PDF</span>
            <strong>{file ? file.name : 'Choose a PDF file'}</strong>
            <small>Maximum size: 4 MB on Vercel</small>
          </label>
          <label className="admin-key-field">
            <span>Admin key</span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => {
                setAdminKey(event.target.value);
                sessionStorage.setItem('askSeniorAdminKey', event.target.value);
              }}
              placeholder="Configured on the backend"
              autoComplete="off"
            />
          </label>
          <button className="upload-btn" type="submit" disabled={isUploading}>
            {isUploading ? 'Starting upload...' : 'Start ingestion'}
          </button>
        </form>

        {error && <div className="admin-alert error">{error}</div>}

        {job && (
          <section className="job-card">
            <div className="job-heading">
              <div>
                <span className="upload-kicker">02 / ingestion status</span>
                <h2>{job.filename}</h2>
              </div>
              <span className={`status-pill ${job.status}`}>{job.status}</span>
            </div>
            <p>{job.message}</p>
            <div className="progress-track">
              <div className="progress-value" style={{ width: `${progress}%` }} />
            </div>
            <div className="job-meta">
              <span>{job.completed_chunks} / {job.total_chunks || '...'} chunks</span>
              <span>{progress}%</span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const quizTopics = {
  TOC: ['Finite Automata', 'Regular Expressions', 'Context-Free Grammars'],
  DBMS: ['Relational Model', 'SQL', 'Normalization'],
  OS: ['Disk Scheduling'],
  CN: ['Computer Networks Fundamentals', 'Data Link Layer', 'Network Layer'],
};

const noteDepartments = ['CSE', 'ECE', 'EEE', 'ME', 'CE', 'Other'];
const noteSemesters = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
const noteSchemes = ['2015', '2019', '2024', 'Other'];

function NotesHeader({ user, title }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="notes-header">
      <a href="/" aria-label="Go to askSenior home">
        <img className="notes-logo" src="/asksenior-logo.jpeg" alt="askSenior" />
      </a>
      <div className="notes-header-actions">
        <span className="notes-page-title">{title}</span>
        {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" />}
        <button className="notes-mobile-toggle" type="button" onClick={() => setIsOpen((open) => !open)} aria-label="Open notes navigation" aria-expanded={isOpen}>☰</button>
        <nav className={`notes-header-nav ${isOpen ? 'open' : ''}`} aria-label="Notes navigation">
          <a className="quiz-link" href="/">Home</a>
          <a className="quiz-link" href="/notes">Download notes</a>
          <a className="quiz-link" href="/add-notes">Add notes</a>
          <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
        </nav>
      </div>
    </header>
  );
}

function AddNotesPage({ user }) {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [fields, setFields] = useState({
    department: 'CSE',
    semester: 'S5',
    subject: '',
    module_no: '',
    scheme: '2024',
    uploader_name: '',
    uploader_semester: 'S5',
    uploader_college: '',
  });
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ type: '', text: '' });
  const [isUploading, setIsUploading] = useState(false);

  const updateField = (event) => {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setStatus({ type: 'error', text: 'Choose a PDF before uploading.' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus({ type: 'error', text: 'Notes must be 10 MB or smaller.' });
      return;
    }

    setStatus({ type: '', text: '' });
    setIsUploading(true);
    const formData = new FormData();
    Object.entries(fields).forEach(([name, value]) => formData.append(name, value));
    formData.append('file', file);

    try {
      const token = await user.getIdToken(true);
      const response = await fetch(`${apiBaseUrl}/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Could not upload the note.');
      setFile(null);
      event.target.reset();
      setStatus({ type: 'success', text: 'Note uploaded successfully. It is now available in Download notes.' });
    } catch (uploadError) {
      setStatus({ type: 'error', text: uploadError.message });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="notes-page">
      <NotesHeader user={user} title="Add notes" />
      <section className="notes-card notes-form-card">
        <div className="notes-intro">
          <p className="eyebrow">askSenior / upload notes</p>
          <h1>Add notes</h1>
          <p>Tell us where the notes belong, then upload a PDF for other students to find and download.</p>
        </div>
        <form className="notes-form" onSubmit={handleSubmit}>
          <div className="notes-section-title">Note details</div>
          <div className="notes-fields-grid">
            <label className="notes-field">Department<select name="department" value={fields.department} onChange={updateField}>{noteDepartments.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="notes-field">Semester<select name="semester" value={fields.semester} onChange={updateField}>{noteSemesters.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="notes-field">Subject<input name="subject" value={fields.subject} onChange={updateField} placeholder="e.g. Semiconductor Physics" required /></label>
            <label className="notes-field">Module number<input name="module_no" value={fields.module_no} onChange={updateField} placeholder="e.g. Module I" required /></label>
            <label className="notes-field">Scheme<select name="scheme" value={fields.scheme} onChange={updateField}>{noteSchemes.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <div className="notes-section-title">Your details</div>
          <div className="notes-fields-grid">
            <label className="notes-field">Your name<input name="uploader_name" value={fields.uploader_name} onChange={updateField} placeholder="e.g. Your name" required /></label>
            <label className="notes-field">Your semester<select name="uploader_semester" value={fields.uploader_semester} onChange={updateField}>{noteSemesters.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="notes-field notes-field-wide">College<input name="uploader_college" value={fields.uploader_college} onChange={updateField} placeholder="e.g. College name" required /></label>
          </div>
          <label className="notes-file-field">PDF file<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required /><span>{file ? file.name : 'Choose a PDF, up to 10 MB'}</span></label>
          <button className="notes-submit-btn" type="submit" disabled={isUploading}>{isUploading ? 'Uploading note...' : 'Upload note'}</button>
        </form>
        {status.text && <div className={`notes-status ${status.type}`} role="status">{status.text}</div>}
      </section>
    </main>
  );
}

function NotesPage({ user }) {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [filters, setFilters] = useState({ department: '', semester: '', subject: '', module_no: '', scheme: '' });
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value.trim()));
    fetch(`${apiBaseUrl}/notes?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.detail || 'Could not load notes.');
        return data;
      })
      .then((data) => {
        setNotes(data);
        setStatus('');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setStatus(error.message);
      })
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [apiBaseUrl, filters]);

  const updateFilter = (event) => {
    setIsLoading(true);
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  };
  const groupedNotes = notes.reduce((groups, note) => {
    const category = `${note.department} / ${note.semester} / ${note.subject} / ${note.module_no} / Scheme ${note.scheme}`;
    groups[category] = [...(groups[category] || []), note];
    return groups;
  }, {});

  return (
    <main className="notes-page">
      <NotesHeader user={user} title="Download notes" />
      <section className="notes-card notes-library-card">
        <div className="notes-intro">
          <p className="eyebrow">askSenior / notes library</p>
          <h1>Download notes</h1>
          <p>Browse notes by department, semester, subject, and scheme.</p>
        </div>
        <div className="notes-filters">
          <select name="department" value={filters.department} onChange={updateFilter} aria-label="Filter by department"><option value="">All departments</option>{noteDepartments.map((item) => <option key={item}>{item}</option>)}</select>
          <select name="semester" value={filters.semester} onChange={updateFilter} aria-label="Filter by semester"><option value="">All semesters</option>{noteSemesters.map((item) => <option key={item}>{item}</option>)}</select>
          <input name="subject" value={filters.subject} onChange={updateFilter} placeholder="Filter subject" aria-label="Filter by subject" />
          <input name="module_no" value={filters.module_no} onChange={updateFilter} placeholder="Filter module" aria-label="Filter by module number" />
          <select name="scheme" value={filters.scheme} onChange={updateFilter} aria-label="Filter by scheme"><option value="">All schemes</option>{noteSchemes.map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        {status && <div className="notes-status error" role="alert">{status}</div>}
        {isLoading ? <p className="notes-empty">Loading notes...</p> : !notes.length ? <p className="notes-empty">No notes match these filters yet. Add the first one.</p> : (
          <div className="notes-groups">
            {Object.entries(groupedNotes).map(([category, categoryNotes]) => (
              <section className="notes-group" key={category}>
                <h2>{category}</h2>
                {categoryNotes.map((note) => (
                  <article className="note-item" key={note.id}>
                    <div>
                      <strong>{note.filename}</strong>
                      <p>Added by {note.uploader_name} · {note.uploader_college} · {new Date(note.created_at).toLocaleDateString()}</p>
                    </div>
                    <a className="note-download-btn" href={`${apiBaseUrl}/notes/${encodeURIComponent(note.id)}/download`}>Download</a>
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Dashboard({ user }) {
  const dashboardPrompt = 'What would you like to do?';
  const promptWords = dashboardPrompt.split(' ');
  const [isNavOpen, setIsNavOpen] = useState(false);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <img className="dashboard-logo" src="/asksenior-logo.jpeg" alt="askSenior" />
        <div className="dashboard-account">
          {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" />}
          <span>{user.displayName || 'Student'}</span>
          <button className="dashboard-mobile-toggle" type="button" onClick={() => setIsNavOpen((open) => !open)} aria-label="Open navigation" aria-expanded={isNavOpen}>☰</button>
          <nav className={`dashboard-nav ${isNavOpen ? 'open' : ''}`} aria-label="Home navigation">
            <button className="quiz-link" onClick={() => { window.location.href = '/notes'; }}>Notes</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/add-notes'; }}>Add notes</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/about'; }}>About</button>
            <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
          </nav>
        </div>
      </header>
      <main className="dashboard-content">
        <h1 className="dashboard-title" aria-label={dashboardPrompt}>
          {promptWords.map((word, index) => (
            <span
              className="dashboard-title-word"
              key={`${word}-${index}`}
              style={{
                '--word-index': index,
                marginRight: index < promptWords.length - 1 ? '0.28em' : undefined,
              }}
              aria-hidden="true"
            >
              {word}
            </span>
          ))}
          <span className="typing-cursor" aria-hidden="true" />
        </h1>
        <div className="dashboard-options">
          <button className="dashboard-option chat-option" onClick={() => { window.location.href = '/chat'; }}>
            <span className="option-number">01</span>
            <span className="option-icon">&#8594;</span>
            <strong>Ask askSenior</strong>
            <span>Chat with your KTU syllabus assistant and get answers from the available notes.</span>
            <small>Open chat</small>
          </button>
          <button className="dashboard-option quiz-option" onClick={() => { window.location.href = '/quiz'; }}>
            <span className="option-number">02</span>
            <span className="option-icon">?</span>
            <strong>Take a quiz</strong>
            <span>Choose a subject and topic, then test your understanding with generated questions.</span>
            <small>Start practice</small>
          </button>
        </div>
      </main>
    </div>
  );
}

const defaultChatMessages = [{
  role: 'bot',
  text: "Hello! I'm askSenior. I can answer questions based on your KTU B.Tech CSE syllabus notes. What do you want to learn today?",
}];

const base64UrlToBytes = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const getSharedChatToken = () => {
  const queryToken = new URLSearchParams(window.location.search).get('shared');
  if (queryToken) return queryToken;
  return window.location.hash.startsWith('#shared=')
    ? decodeURIComponent(window.location.hash.slice(8))
    : null;
};

const getSharedChatId = () => new URLSearchParams(window.location.search).get('share');

const decodeSharedChat = async (token) => {
  if (!token) return null;
  const [format, encoded] = token.split('.', 2);
  let bytes = base64UrlToBytes(encoded || format);
  if (format === 'g' && typeof DecompressionStream !== 'undefined') {
    const decompressionStream = new DecompressionStream('gzip');
    const writer = decompressionStream.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
    bytes = new Uint8Array(await new Response(decompressionStream.readable).arrayBuffer());
  }
  const messages = JSON.parse(new TextDecoder().decode(bytes));
  return Array.isArray(messages) && messages.every((message) => message.role && typeof message.text === 'string')
    ? messages
    : null;
};

const copyTextToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy clipboard API.
    }
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  textArea.remove();
  return copied;
};

function QuizApp({ user }) {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [subject, setSubject] = useState('TOC');
  const [topic, setTopic] = useState('');
  const [questionCount, setQuestionCount] = useState(5);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [score, setScore] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const currentQuestion = questions[currentIndex];
  const hasStarted = questions.length > 0;

  const handleSubjectChange = (event) => {
    const nextSubject = event.target.value;
    setSubject(nextSubject);
    setTopic('');
  };

  const generateQuiz = async (event) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    setQuestions([]);
    setIsComplete(false);
    try {
      const typedTopic = topic.trim();
      if (!typedTopic) {
        setError('Enter a topic before creating the quiz.');
        setIsLoading(false);
        return;
      }
      const response = await fetch(`${apiBaseUrl}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, topic: typedTopic, question_count: questionCount }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Could not create the quiz.');
      setQuestions(data.questions);
      setCurrentIndex(0);
      setSelectedOption(null);
      setScore(0);
    } catch (quizError) {
      setError(quizError.message);
    } finally {
      setIsLoading(false);
    }
  };

  const chooseOption = (optionIndex) => {
    if (selectedOption !== null) return;
    setSelectedOption(optionIndex);
  };

  const nextQuestion = () => {
    const earned = selectedOption === currentQuestion.answer_index ? 1 : 0;
    const nextScore = score + earned;
    setScore(nextScore);
    if (currentIndex === questions.length - 1) {
      setIsComplete(true);
      return;
    }
    setCurrentIndex((index) => index + 1);
    setSelectedOption(null);
  };

  return (
    <div className="quiz-shell">
      <header className="quiz-header">
        <button className="text-btn" onClick={() => { window.location.href = '/'; }}>Back to home</button>
        <div className="quiz-account">
          {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" />}
          <button className="quiz-link" onClick={() => { window.location.href = '/notes'; }}>Notes</button>
          <button className="quiz-link" onClick={() => { window.location.href = '/add-notes'; }}>Add notes</button>
          <button className="quiz-link" onClick={() => { window.location.href = '/about'; }}>About</button>
          <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </header>
      <main className="quiz-card">
        <div className="quiz-intro">
          <p className="eyebrow">askSenior / practice room</p>
          <h1>Test your knowledge</h1>
          <p>Generate syllabus-based questions from the notes currently available to askSenior.</p>
        </div>

        {!hasStarted && (
          <form className="quiz-setup" onSubmit={generateQuiz}>
            <label>
              Subject
              <select value={subject} onChange={handleSubjectChange}>
                {Object.keys(quizTopics).map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Topic
              <input
                type="text"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="Type a topic, e.g. normalization"
                required
              />
            </label>
            <label>
              Questions
              <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
                <option value="3">3 questions</option>
                <option value="5">5 questions</option>
                <option value="10">10 questions</option>
              </select>
            </label>
            <button className="quiz-start-btn" type="submit" disabled={isLoading}>
              {isLoading ? 'Creating quiz...' : 'Create quiz'}
            </button>
          </form>
        )}

        {error && <div className="admin-alert error">{error}</div>}

        {hasStarted && !isComplete && currentQuestion && (
          <section className="question-card">
            <div className="question-meta">Question {currentIndex + 1} of {questions.length}</div>
            <h2>{currentQuestion.question}</h2>
            <div className="quiz-options">
              {currentQuestion.options.map((option, optionIndex) => {
                const isCorrect = optionIndex === currentQuestion.answer_index;
                const isSelected = optionIndex === selectedOption;
                const stateClass = selectedOption === null ? '' : isCorrect ? 'correct' : isSelected ? 'incorrect' : '';
                return (
                  <button className={`quiz-option ${stateClass}`} key={option} onClick={() => chooseOption(optionIndex)}>
                    <span>{String.fromCharCode(65 + optionIndex)}</span>{option}
                  </button>
                );
              })}
            </div>
            {selectedOption !== null && (
              <div className="answer-explanation">
                <strong>{selectedOption === currentQuestion.answer_index ? 'Correct!' : 'Not quite.'}</strong>
                <p>{currentQuestion.explanation}</p>
              </div>
            )}
            <button className="quiz-next-btn" onClick={nextQuestion} disabled={selectedOption === null}>
              {currentIndex === questions.length - 1 ? 'See result' : 'Next question'}
            </button>
          </section>
        )}

        {isComplete && (
          <section className="quiz-result">
            <p className="eyebrow">Quiz complete</p>
            <div className="score-number">{score}<span>/{questions.length}</span></div>
            <h2>{score === questions.length ? 'Excellent work!' : 'Keep practicing!'}</h2>
            <p>You answered {score} out of {questions.length} questions correctly.</p>
            <button className="quiz-start-btn" onClick={() => { setQuestions([]); setIsComplete(false); }}>Try another quiz</button>
          </section>
        )}
      </main>
    </div>
  );
}

function ChatApp({ user }) {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [messages, setMessages] = useState(defaultChatMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [isNavOpen, setIsNavOpen] = useState(false);
  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    const sharedId = getSharedChatId();
    if (sharedId) {
      fetch(`${apiBaseUrl}/share/${encodeURIComponent(sharedId)}`)
        .then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.detail || 'Shared chat could not be loaded.');
          return data;
        })
        .then((data) => setMessages(data.messages))
        .catch((error) => setShareMessage(error.message));
      return undefined;
    }

    const sharedToken = getSharedChatToken();
    if (!sharedToken) return undefined;
    decodeSharedChat(sharedToken).then((sharedMessages) => {
      if (sharedMessages) setMessages(sharedMessages);
    }).catch(() => setShareMessage('This shared chat link is invalid or expired.'));
    return undefined;
  }, [apiBaseUrl]);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceMessage('Voice input is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setVoiceMessage('Listening...');
      setIsListening(true);
    };
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(' ');
      setInput(transcript);
    };
    recognition.onerror = () => {
      setVoiceMessage('Microphone input could not be captured.');
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
      setVoiceMessage('');
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    e?.currentTarget?.querySelector('input')?.blur();
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${apiBaseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || 'Backend error');
      }

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'bot', text: data.reply }]);
    } catch (error) {
      console.error(error);
      const errorMsg = error.message.includes('RESOURCE_EXHAUSTED')
        ? "Google Gemini API rate limit hit! The free-tier handles 1000 requests per day. Since I've learned a massive book today, please wait until the quota resets to ask queries."
        : `Server Error: ${error.message}`;

      setMessages(prev => [
        ...prev,
        { role: 'bot', text: errorMsg }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleShareChat = async () => {
    setShareMessage('Preparing share link...');
    try {
      const response = await fetch(`${apiBaseUrl}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || 'Could not create a share link.');
      const shareUrl = `${window.location.origin}/chat?share=${encodeURIComponent(data.share_id)}`;
      if (navigator.share) {
        await navigator.share({
          title: 'askSenior chat',
          text: `View this askSenior chat:\n${shareUrl}`,
        });
        setShareMessage('Chat ready to share');
      } else {
        const copied = await copyTextToClipboard(shareUrl);
        if (copied) {
          setShareMessage('Share link copied. Paste it in WhatsApp.');
        } else {
          window.open(`https://wa.me/?text=${encodeURIComponent(`View this askSenior chat: ${shareUrl}`)}`, '_blank', 'noopener,noreferrer');
          setShareMessage('Opening WhatsApp...');
        }
      }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setShareMessage('Could not create a share link');
    }
  };



  return (
    <div className="app-container">
      <div className="header chat-header">
        <div>
          <img className="brand-logo" src="/asksenior-logo.jpeg" alt="askSenior" />
          <p>KTU B.Tech CSE Syllabus Assistant</p>
          <p className="app-disclaimer" >
            <strong>Note:</strong> This webapp is not trained on the complete KTU syllabus. It currently covers TOC(S3,KTU) DBMS (S4, KTU), OS - Disk Scheduling (S4, KTU), and CN ( S5, KTU). The content is based on the corresponding KTU textbooks and summary of those textbooks.
          </p>
        </div>
        <div className="account-area">
          <button
            className="share-chat-btn"
            type="button"
            onClick={handleShareChat}
            disabled={isLoading}
            title="Share this chat"
            aria-label="Share this chat"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="18" cy="5" r="2.5" />
              <circle cx="6" cy="12" r="2.5" />
              <circle cx="18" cy="19" r="2.5" />
              <path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" />
            </svg>
          </button>
          {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" />}
          <button
            className="mobile-nav-toggle"
            type="button"
            aria-label="Open navigation"
            aria-expanded={isNavOpen}
            onClick={() => setIsNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <nav className={`account-nav ${isNavOpen ? 'open' : ''}`} aria-label="Chat navigation">
            <button className="quiz-link" onClick={() => { window.location.href = '/'; }}>Home</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/quiz'; }}>Quiz</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/notes'; }}>Notes</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/add-notes'; }}>Add notes</button>
            <button className="quiz-link" onClick={() => { window.location.href = '/about'; }}>About</button>
            <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
          </nav>
        </div>
      </div>
      {shareMessage && <div className="share-status" role="status">{shareMessage}</div>}

      <div className="chat-container" ref={scrollRef}>
        {messages.map((msg, index) => (
          <div key={index} className={`message-wrapper ${msg.role}`}>
            <div className={`message ${msg.role}`}>
              <div className="markdown-content">
                <ReactMarkdown>{msg.text}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message-wrapper bot">
            <div className="typing-indicator">
              <div className="typing-dot"></div>
              <div className="typing-dot"></div>
              <div className="typing-dot"></div>
            </div>
          </div>
        )}
      </div>

      <div className="input-container">
        <form className="input-box" onSubmit={handleSend}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your syllabus..."
            disabled={isLoading}
          />
          <button
            type="button"
            className={`voice-btn ${isListening ? 'listening' : ''}`}
            onClick={toggleVoiceInput}
            disabled={isLoading}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop listening' : 'Use voice input'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="2" width="6" height="12" rx="3"></rect>
              <path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"></path>
            </svg>
          </button>
          <button
            type="submit"
            className="send-btn"
            disabled={isLoading || !input.trim()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
        {voiceMessage && <div className="voice-status" role="status">{voiceMessage}</div>}
        <footer className="app-footer">
          <span>&copy; Abhijith V S, S5 CSE, RIT Kottayam</span>
          <span className="footer-links">
            <a href="/about">About me</a>
            <a href="https://www.linkedin.com/in/abhijith-v-s-98b326314?utm_source=share_via&utm_content=profile&utm_medium=member_android" target="_blank" rel="noreferrer">
              <svg className="linkedin-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M5.2 7.2A2.2 2.2 0 1 0 5.2 2.8a2.2 2.2 0 0 0 0 4.4ZM3.3 21.2h3.8V9.1H3.3v12.1ZM9.5 9.1v12.1h3.8v-6c0-1.6.3-3.2 2.3-3.2 1.9 0 1.9 1.9 1.9 3.3v5.9h3.8v-6.7c0-3.3-.7-5.8-4.7-5.8-1.9 0-3.2 1-3.7 2h-.1V9.1H9.5Z" />
              </svg>
              LinkedIn
            </a>
            <a href="mailto:vsabhijithin17@gmail.com">vsabhijithin17@gmail.com</a>
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  // Admin ingestion is paused while the Neon-backed queue is disabled.
  const [user, setUser] = useState(() => (firebaseConfigured ? undefined : null));

  useEffect(() => {
    if (!firebaseConfigured) return undefined;

    return onAuthStateChanged(auth, setUser);
  }, []);

  if (window.location.pathname === '/about') return <AboutPage />;
  if (user === undefined) return null;
  if (!user) return <AuthScreen />;
  if (window.location.pathname === '/quiz') return <QuizApp user={user} />;
  if (window.location.pathname === '/chat') return <ChatApp user={user} />;
  if (window.location.pathname === '/add-notes') return <AddNotesPage user={user} />;
  if (window.location.pathname === '/notes') return <NotesPage user={user} />;
  return <Dashboard user={user} />;
}
