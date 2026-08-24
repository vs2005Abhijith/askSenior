import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import './App.css';

function AdminDashboard() {
  const apiBaseUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5001')
    : '/api';
  const [adminKey, setAdminKey] = useState('');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [isUploading, setIsUploading] = useState(false);

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
            <small>Maximum size: 25 MB</small>
          </label>
          <label className="admin-key-field">
            <span>Admin key</span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
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

function ChatApp() {
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
          <h1>askSenior</h1>
          <p>KTU B.Tech CSE Syllabus Assistant</p>
        </div>
        <button className="text-btn" onClick={() => { window.location.href = '/admin'; }}>
          Admin
        </button>
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
      </div>
    </div>
  );
}

export default function App() {
  return window.location.pathname === '/admin' ? <AdminDashboard /> : <ChatApp />;
}
