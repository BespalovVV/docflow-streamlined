// Minimal Service Worker for DocFlow PWA installation
const SW_VERSION = 'docflow-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through network handler so API, ONLYOFFICE and live data always stay fresh
  if (event.request.method !== 'GET') return;
});
