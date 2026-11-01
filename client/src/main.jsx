import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AdminStandalone from './AdminStandalone.jsx';
import { tg, inTelegram } from './api.js';
import './styles.css';

tg?.ready();
tg?.expand();
try { tg?.disableVerticalSwipes?.(); } catch { /* older clients */ }

// /admin opened in a normal browser → password-protected admin panel.
// Inside Telegram, admins get an Admin tab in the normal app instead.
const browserAdmin = location.pathname.startsWith('/admin') && !inTelegram;
createRoot(document.getElementById('root')).render(browserAdmin ? <AdminStandalone /> : <App />);
