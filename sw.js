self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    // Block common YouTube ad domains
    const adDomains = [
        'doubleclick.net',
        'googleads.g.doubleclick.net',
        'googleadservices.com',
        'googlesyndication.com',
        'adservice.google.com'
    ];
    
    if (adDomains.some(domain => url.hostname.includes(domain))) {
        return event.respondWith(new Response('', { status: 204 }));
    }

    event.respondWith(fetch(event.request));
});
