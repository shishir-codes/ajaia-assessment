// Tiny hash router: #/ is the home page, #/doc/<id> opens a document. Anything else is home.
import { useEffect, useState } from 'react';

export function parseHash(hash) {
  const path = String(hash || '').replace(/^#/, '');
  const match = /^\/doc\/([^/?#]+)\/?$/.exec(path);
  if (match) {
    try {
      return { name: 'doc', id: decodeURIComponent(match[1]) };
    } catch {
      return { name: 'home' };
    }
  }
  return { name: 'home' };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function docHref(id) {
  return `#/doc/${encodeURIComponent(id)}`;
}

export function navigate(href) {
  const target = href.startsWith('#') ? href : `#${href}`;
  if (window.location.hash !== target) window.location.hash = target;
}
