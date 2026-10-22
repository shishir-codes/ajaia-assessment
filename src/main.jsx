import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Shows a recovery screen instead of a blank page if a render error slips through.
class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('UI error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Please reload the page. If it keeps happening, let us know what you were doing.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
