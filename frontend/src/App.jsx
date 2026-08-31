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

function ChatApp({ user }) {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      text: "Hello! I'm askSenior. I can answer questions based on your KTU B.Tech CSE syllabus notes. What do you want to learn today?"
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

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
          {user.photoURL && <img className="account-avatar" src={user.photoURL} alt="" />}
          <button className="signout-btn" onClick={() => signOut(auth)}>Sign out</button>
        </div>
      </div>

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
        <footer className="app-footer">
          <span>&copy; Abhijith V S, S5 CSE, RIT Kottayam</span>
          <span className="footer-links">
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

  if (user === undefined) return null;
  if (!user) return <AuthScreen />;
  return <ChatApp user={user} />;
}
