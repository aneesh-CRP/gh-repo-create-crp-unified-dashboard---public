// CRP Dashboard Service Worker — Offline Support + Smart Caching
const CACHE_NAME = 'crp-dashboard-v9';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.js',
  '/fallback-data.json',
  '/coord-history.json',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap'
];

// Max age for cached data feeds (15 min matches BQ sync interval)
const DATA_MAX_AGE_MS = 15 * 60 * 1000;

// Normalize Google Sheets URLs by stripping cache-busting params
function normalizeUrl(url) {
  try {
    var u = new URL(url);
    u.searchParams.delete('_cb');
    return u.toString();
  } catch (e) {
    return url;
  }
}

// Install: pre-cache static assets
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Google Sheets data URLs: network-first with timeout, cache fallback
  if (url.includes('docs.google.com/spreadsheets')) {
    event.respondWith(
      networkFirstWithTimeout(event.request, 8000)
    );
    return;
  }

  // Meta Ads / external APIs: network-first, cache fallback
  if (url.includes('graph.facebook.com')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(normalizeUrl(url), clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(normalizeUrl(url));
      })
    );
    return;
  }

  // HTML and JS files: network-first (always get latest code)
  if (url.endsWith('.html') || url.endsWith('.js') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Other static assets (fonts, images): cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response.ok && event.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});

// Network-first with timeout: try network, fall back to cache if slow/offline
function networkFirstWithTimeout(request, timeoutMs) {
  var normalizedKey = normalizeUrl(request.url);

  return new Promise(function(resolve) {
    var settled = false;
    var timer = null;

    // Start network fetch
    var networkPromise = fetch(request).then(function(response) {
      if (response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          // Store with timestamp header for age checking
          var headers = new Headers(clone.headers);
          headers.set('sw-cached-at', Date.now().toString());
          var timedResponse = new Response(clone.body, {
            status: clone.status,
            statusText: clone.statusText,
            headers: headers
          });
          cache.put(normalizedKey, timedResponse);
        });
      }
      if (!settled) { settled = true; clearTimeout(timer); resolve(response); }
    }).catch(function() {
      // Network failed — try cache
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        caches.match(normalizedKey).then(function(cached) {
          resolve(cached || new Response('', { status: 503, statusText: 'Offline' }));
        });
      }
    });

    // Timeout: if network is slow, serve cache immediately
    timer = setTimeout(function() {
      if (!settled) {
        caches.match(normalizedKey).then(function(cached) {
          if (cached && !settled) {
            settled = true;
            resolve(cached);
            // Let network fetch continue in background to update cache
          }
          // If no cache, keep waiting for network
        });
      }
    }, timeoutMs);
  });
}
