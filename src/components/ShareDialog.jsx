import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Avatar from './Avatar.jsx';
import { AlertIcon } from './Icons.jsx';
import Modal from './Modal.jsx';

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Can view' },
  { value: 'editor', label: 'Can edit' },
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ShareDialog({ doc, currentUser, onClose }) {
  const [access, setAccess] = useState({ status: 'loading', owner: null, shares: [], error: '' });
  const [directory, setDirectory] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(''); // 'add' or a userId being changed
  const [announce, setAnnounce] = useState('');
  const emailRef = useRef(null);

  const loadAccess = useCallback(async () => {
    try {
      const data = await api.listShares(doc.id);
      setAccess({ status: 'ready', owner: data.owner || null, shares: Array.isArray(data.shares) ? data.shares : [], error: '' });
    } catch (err) {
      setAccess((a) => ({ ...a, status: 'error', error: err.message }));
    }
  }, [doc.id]);

  useEffect(() => {
    loadAccess();
    api
      .listUsers()
      .then((data) => setDirectory(Array.isArray(data.users) ? data.users : []))
      .catch(() => setDirectory([])); // suggestions are optional; typing an email still works
  }, [loadAccess]);

  const ownerEmail = (access.owner?.email || currentUser.email || '').toLowerCase();
  const suggestions = useMemo(() => {
    const taken = new Set([ownerEmail, ...access.shares.map((s) => String(s.email).toLowerCase())]);
    return directory.filter((u) => !taken.has(String(u.email).toLowerCase()));
  }, [directory, access.shares, ownerEmail]);

  async function addPerson(event) {
    event.preventDefault();
    if (busy) return;
    const value = email.trim().toLowerCase();
    let problem = '';
    if (!value) problem = 'Enter the email address of the person you want to share with.';
    else if (!EMAIL_SHAPE.test(value)) problem = 'That does not look like an email address. For example: bob@example.com';
    else if (value === ownerEmail) problem = 'You own this document, so you already have full access.';
    if (problem) {
      setFormError(problem);
      emailRef.current?.focus();
      return;
    }
    setBusy('add');
    setFormError('');
    try {
      const data = await api.share(doc.id, value, role);
      const label = ROLE_OPTIONS.find((r) => r.value === role)?.label.toLowerCase() || role;
      const name = data.share?.name || value;
      setEmail('');
      setAnnounce(`Shared with ${name}. They ${label === 'can edit' ? 'can edit' : 'can view'} this document.`);
      await loadAccess();
    } catch (err) {
      setFormError(
        err.code === 'unknown_user'
          ? `There is no account for ${value}. Demo accounts: ${directory.map((u) => u.email).join(', ') || 'see the suggestions'}.`
          : err.message,
      );
      emailRef.current?.focus();
    } finally {
      setBusy('');
    }
  }

  async function changeRole(share, nextRole) {
    if (busy || nextRole === share.role) return;
    setBusy(share.userId);
    setListError('');
    try {
      await api.share(doc.id, share.email, nextRole);
      setAnnounce(`${share.name} ${nextRole === 'editor' ? 'can now edit' : 'can now only view'} this document.`);
      await loadAccess();
    } catch (err) {
      setListError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function remove(share) {
    if (busy) return;
    setBusy(share.userId);
    setListError('');
    try {
      await api.unshare(doc.id, share.userId);
      setAnnounce(`Removed access for ${share.name}.`);
      await loadAccess();
    } catch (err) {
      setListError(err.message);
    } finally {
      setBusy('');
    }
  }

  const owner = access.owner || { id: currentUser.id, name: currentUser.name, email: currentUser.email };

  return (
    <Modal
      title={`Share "${doc.title}"`}
      titleId="share-title"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <form className="share-form" onSubmit={addPerson} noValidate>
        <div className="field share-email">
          <label htmlFor="share-email" className="label">
            Add people by email
          </label>
          <input
            ref={emailRef}
            id="share-email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="off"
            list="share-suggestions"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (formError) setFormError('');
            }}
            aria-invalid={formError ? 'true' : undefined}
            aria-describedby={formError ? 'share-error' : 'share-hint'}
          />
          <datalist id="share-suggestions">
            {suggestions.map((u) => (
              <option key={u.id} value={u.email}>
                {u.name}
              </option>
            ))}
          </datalist>
        </div>
        <div className="field share-role">
          <label htmlFor="share-role" className="label">
            Access
          </label>
          <select id="share-role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary share-submit" disabled={busy === 'add'}>
          {busy === 'add' ? 'Sharing...' : 'Share'}
        </button>
      </form>
      {formError ? (
        <p id="share-error" className="field-error" role="alert">
          <AlertIcon className="icon-sm" />
          <span>{formError}</span>
        </p>
      ) : (
        <p id="share-hint" className="hint">
          {suggestions.length > 0
            ? `Suggestions: ${suggestions.map((u) => `${u.name} (${u.email})`).join(', ')}`
            : 'Everyone in the directory already has access.'}
        </p>
      )}

      <h3 className="share-subtitle">People with access</h3>
      {access.status === 'loading' ? <p className="hint">Loading...</p> : null}
      {access.status === 'error' ? (
        <div className="alert alert-error" role="alert">
          <AlertIcon className="icon-sm" />
          <span>{access.error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadAccess}>
            Try again
          </button>
        </div>
      ) : null}
      {listError ? (
        <p className="field-error" role="alert">
          <AlertIcon className="icon-sm" />
          <span>{listError}</span>
        </p>
      ) : null}
      {access.status === 'ready' ? (
        <ul className="access-list">
          <li className="access-row">
            <Avatar user={owner} size={36} />
            <span className="access-text">
              <span className="access-name">
                {owner.name}
                {owner.id === currentUser.id ? ' (you)' : ''}
              </span>
              <span className="access-email">{owner.email}</span>
            </span>
            <span className="access-role-fixed">Owner</span>
          </li>
          {access.shares.map((share) => (
            <li key={share.userId} className="access-row">
              <Avatar user={{ id: share.userId, name: share.name }} size={36} />
              <span className="access-text">
                <span className="access-name">{share.name}</span>
                <span className="access-email">{share.email}</span>
              </span>
              <span className="access-controls">
                <label className="sr-only" htmlFor={`role-${share.userId}`}>
                  Access level for {share.name}
                </label>
                <select
                  id={`role-${share.userId}`}
                  className="select select-sm"
                  value={share.role}
                  disabled={Boolean(busy)}
                  onChange={(e) => changeRole(share, e.target.value)}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger-text"
                  disabled={Boolean(busy)}
                  onClick={() => remove(share)}
                  aria-label={`Remove access for ${share.name}`}
                >
                  {busy === share.userId ? 'Working...' : 'Remove'}
                </button>
              </span>
            </li>
          ))}
          {access.shares.length === 0 ? <li className="access-empty hint">Not shared with anyone yet.</li> : null}
        </ul>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </Modal>
  );
}
