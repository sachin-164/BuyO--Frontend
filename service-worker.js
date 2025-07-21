self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('shop-cache-v1').then(cache => {
            const urlsToCache = [
                '/',
                'index.html',
                'css/Homepage.css',
                'js/script.js',
                'assets/icons/logo.png',
                'assets/icons/search-icon.png',
                'assets/icons/profile.png',
                'assets/icons/cart-icon.png',
                'assets/icons/wishlist-icon.png',
                'assets/icons/favicon.png'
            ];
            // Fetch each URL individually to handle failures gracefully
            return Promise.all(
                urlsToCache.map(url => {
                    return fetch(url, { mode: 'no-cors' })
                        .then(response => {
                            if (!response.ok && response.type !== 'opaque') {
                                console.warn(`Failed to fetch ${url}: ${response.status}`);
                                return null; // Skip failed fetches
                            }
                            return cache.put(url, response);
                        })
                        .catch(error => {
                            console.warn(`Error fetching ${url}: ${error}`);
                            return null; // Skip errors
                        });
                }).filter(result => result !== null)
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});