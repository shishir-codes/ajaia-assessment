import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import Home from './components/Home.jsx';
import { AlertIcon } from './components/Icons.jsx';
import SignIn from './components/SignIn.jsx';
import { APP } from './config.js';
import { api, setUnauthenticatedHandler } from './lib/api.js';
import { flushPending, UNSAVED_PROMPT } from './lib/pending.js';
import { navigate, useHashRoute } from './lib/router.js';

// The editor (TipTap) is the heaviest part, so it loads only when a document is opened.
const EditorPage = lazy(() => import('./components/EditorPage.jsx'));

function PageLoading({ label = 'Loading...' }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function skipToMain(event) {
  event.preventDefault(); // a plain #main link would change the hash route
  document.getElementById('main')?.focus();
}

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState({ status: 'loading', user: null, error: '' });
  const [switching, setSwitching] = useState(false);
  const [flash, setFlash] = useState('');
  const [signInNotice, setSignInNotice] = useState('');

  const loadSession = useCallback(async (signal) => {
    setSession((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const data = await api.getSession({ signal });
      setSession({ status: 'ready', user: data.user || null, error: '' });
    } catch (err) {
      if (signal?.aborted) return;
      setSession({ status: 'error', user: null, error: err.message });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadSession(controller.signal);
    return () => controller.abort();
  }, [loadSession]);

  // Any 401 from the API means the session is gone: go back to the sign in screen.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setSignInNotice('Your session has ended. Please sign in again.');
      setSession({ status: 'ready', user: null, error: '' });
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  // Clear a stale "Deleted ..." message once people move on to a document.
  useEffect(() => {
    if (route.name === 'doc') setFlash('');
  }, [route.name, route.id]);

  async function switchUser() {
    if (switching) return;
    setSwitching(true);
    const saved = await flushPending(); // do not lose the last edits of the person signing out
    if (!saved && !window.confirm(UNSAVED_PROMPT)) {
      setSwitching(false);
      return;
    }
    try {
      await api.signOut();
    } catch {
      // Even if the server is unreachable, show the sign in screen. The next sign in replaces the cookie.
    }
    // The next person starts on their own document list, not on a document they may not have access to.
    navigate('#/');
    setSwitching(false);
    setFlash('');
    setSignInNotice('');
    setSession({ status: 'ready', user: null, error: '' });
  }

  // The logo goes home, after the open editor (if any) has saved its last changes.
  async function goHome(event) {
    event.preventDefault();
    const saved = await flushPending();
    if (!saved && !window.confirm(UNSAVED_PROMPT)) return;
    navigate('#/');
  }

  if (session.status === 'loading') return <PageLoading label={`Loading ${APP.name}...`} />;

  if (session.status === 'error') {
    return (
      <main className="signin" id="main">
        <div className="signin-card">
          <div className="state state-error" role="alert">
            <AlertIcon className="icon-lg" />
            <p className="state-title">Could not reach {APP.name}</p>
            <p className="state-text">{session.error}</p>
            <button type="button" className="btn btn-primary" onClick={() => loadSession()}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!session.user) {
    return (
      <SignIn
        notice={signInNotice}
        onSignedIn={(user) => {
          setSignInNotice('');
          setSession({ status: 'ready', user, error: '' });
        }}
      />
    );
  }

  const user = session.user;
  return (
    <>
      <a className="skip-link" href="#main" onClick={skipToMain}>
        Skip to content
      </a>
      <Header user={user} onSwitchUser={switchUser} onHome={goHome} switching={switching} />
      <main id="main" tabIndex={-1} className="app-main">
        {route.name === 'doc' ? (
          <Suspense fallback={<PageLoading label="Opening document..." />}>
            <EditorPage key={`${user.id}:${route.id}`} id={route.id} user={user} onNotify={setFlash} />
          </Suspense>
        ) : (
          <Home key={user.id} user={user} flash={flash} onDismissFlash={() => setFlash('')} />
        )}
      </main>
    </>
  );
}
