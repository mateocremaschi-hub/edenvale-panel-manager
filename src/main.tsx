import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { seedFictionalDataIfEmpty } from './lib/fictionalData';

seedFictionalDataIfEmpty().catch((err) => console.error('Seed error', err));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
