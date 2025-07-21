self.addEventListener('install', event => { 
  event.waitUntil(
    caches.open('shop-cache-v1').then(cache => {
      return cache.addAll([
        '/',
        '/index.html',
        '/css/Homepage.css',
        '/js/script.js',
        '/assets/icons/logo.png',
        '/assets/icons/search-icon.png',
        '/assets/icons/profile.png',
        '/assets/icons/cart-icon.png',
        '/assets/icons/wishlist-icon.png',
        '/assets/icons/favicon.png',
        '/favicon.png'
      ]);
    })
  );
  self.skipWaiting(); // Activate new service worker immediately
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
