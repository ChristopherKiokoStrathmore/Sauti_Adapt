// Privacy-preserving PWA worker. Never cache recordings, recognition results, or profiles.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
