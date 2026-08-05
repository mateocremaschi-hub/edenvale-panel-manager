import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeData } from './lib/initData';

const root = ReactDOM.createRoot(document.getElementById('root')!);

function renderLoading(text: string) {
  root.render(
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      <p>{text}</p>
    </div>
  );
}

renderLoading('Starting...');

// Ask the browser not to auto-evict this site's storage under pressure (best-effort --
// not a guarantee against a user-set "clear on close" browser preference, but it removes
// one real cause of losing offline-created reports/replacements before they get to sync).
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {});
}

initializeData((text) => renderLoading(text))
  .catch((err) => console.error('Init error', err))
  .finally(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
