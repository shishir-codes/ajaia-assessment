import { APP } from '../config.js';
import Avatar from './Avatar.jsx';
import { LogoMark } from './Icons.jsx';

export default function Header({ user, onSwitchUser, onHome, switching }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a className="brand" href="#/" onClick={onHome}>
          <LogoMark />
          <span>{APP.name}</span>
        </a>
        <div className="user-area">
          <span className="user-chip" title={user.email}>
            <Avatar user={user} size={32} />
            <span className="user-text">
              <span className="sr-only">Signed in as </span>
              <span className="user-name">{user.name}</span>
              <span className="user-email">{user.email}</span>
            </span>
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSwitchUser} disabled={switching}>
            {switching ? 'Switching...' : 'Switch user'}
          </button>
        </div>
      </div>
    </header>
  );
}
