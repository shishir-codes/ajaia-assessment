import { avatarColor, initials } from '../lib/format.js';

export default function Avatar({ user, size = 32 }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: avatarColor(user?.id || user?.email) }}
    >
      {initials(user?.name)}
    </span>
  );
}
