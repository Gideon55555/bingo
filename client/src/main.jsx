import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { tg, inTelegram, reportError } from './api.js';
import './styles.css';

tg?.ready();
tg?.expand();
try { tg?.disableVerticalSwipes?.(); } catch { /* older clients */ }

// /admin opened in a normal browser → password-protected admin panel.
// Inside Telegram, admins get an Admin tab in the normal app instead.
const browserAdmin = location.pathname.startsWith('/admin') && !inTelegram;
const AdminStandalone = lazy(() => import('./AdminStandalone.jsx'));
/** If a screen crashes, show a friendly message (and report it) instead of a blank page. */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err, info) { reportError(err, (info?.componentStack || '').split('\n').filter(Boolean)[0]?.trim()); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center" style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>😕</div>
        <p>Something went wrong. / የሆነ ችግር ተፈጥሯል።</p>
        <button className="primary" onClick={() => location.reload()}>Reload / እንደገና ጫን</button>
      </div>
    );
  }
}
createRoot(document.getElementById('root')).render(<Boundary>{browserAdmin ? <Suspense fallback={null}><AdminStandalone /></Suspense> : <App />}</Boundary>);
