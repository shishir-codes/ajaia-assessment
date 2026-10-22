import { useCallback, useEffect, useState } from 'react';
import { APP } from '../config.js';
import { api } from '../lib/api.js';
import { firstName } from '../lib/format.js';
import Avatar from './Avatar.jsx';
import { AlertIcon, LogoMark } from './Icons.jsx';

export default function SignIn({ onSignedIn, notice }) {
  const [users, setUsers] = useState({ status: 'loading', list: [], error: '' });
  const [pendingEmail, setPendingEmail] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (signal) => {
    setUsers((u) => ({ ...u, status: 'loading', error: '' }));
    try {
      const data = await api.listUsers({ signal });
      setUsers({ status: 'ready', list: Array.isArray(data.users) ? data.users : [], error: '' });
    } catch (err) {
      if (signal?.aborted) return;
      setUsers({ status: 'error', list: [], error: err.message });
    }
  }, []);

  useEffect(() => {
    document.title = `Sign in - ${APP.name}`;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function signIn(user) {
    if (pendingEmail) return;
    setPendingEmail(user.email);
    setError('');
    try {
      const data = await api.signIn(user.email);
      onSignedIn(data.user);
    } catch (err) {
      setError(err.message);
      setPendingEmail('');
    }
  }

  return (
    <main className="signin" id="main">
      <div className="signin-card">
        <div className="signin-brand">
          <LogoMark className="brand-mark brand-mark-lg" />
          <span>{APP.name}</span>
        </div>
        <h1 className="signin-title">Choose an account</h1>
        <p className="signin-note">Demo sign in: accounts are seeded, no passwords.</p>

        {notice ? (
          <p className="alert alert-info" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="alert alert-error" role="alert">
            <AlertIcon className="icon-sm" />
            <span>{error}</span>
          </p>
        ) : null}

        {users.status === 'loading' ? (
          <ul className="account-list" aria-busy="true" aria-label="Loading accounts">
            {[0, 1, 2].map((i) => (
              <li key={i} className="account account-skeleton">
                <span className="skeleton skeleton-avatar" />
                <span className="skeleton-lines">
                  <span className="skeleton" />
                  <span className="skeleton skeleton-short" />
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {users.status === 'error' ? (
          <div className="state state-error" role="alert">
            <p className="state-title">Could not load the demo accounts</p>
            <p className="state-text">{users.error}</p>
            <button type="button" className="btn btn-secondary" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : null}

        {users.status === 'ready' && users.list.length === 0 ? (
          <div className="state">
            <p className="state-title">No demo accounts found</p>
            <p className="state-text">The server did not return any accounts. Please try again in a moment.</p>
            <button type="button" className="btn btn-secondary" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : null}

        {users.status === 'ready' && users.list.length > 0 ? (
          <ul className="account-list">
            {users.list.map((user) => (
              <li key={user.id} className="account">
                <Avatar user={user} size={40} />
                <span className="account-text">
                  <span className="account-name">{user.name}</span>
                  <span className="account-email">{user.email}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => signIn(user)}
                  disabled={Boolean(pendingEmail)}
                  aria-label={`Sign in as ${user.name}`}
                >
                  {pendingEmail === user.email ? 'Signing in...' : `Sign in as ${firstName(user.name)}`}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
