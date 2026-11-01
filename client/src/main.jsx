import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { tg } from './api.js';
import './styles.css';

tg?.ready();
tg?.expand();
try { tg?.disableVerticalSwipes?.(); } catch { /* older clients */ }

createRoot(document.getElementById('root')).render(<App />);
