// Runs before the app bundle (was inline in index.html; a file so the
// Content-Security-Policy needs no 'unsafe-inline' for scripts).

      // Set --real-vh synchronously so flex layouts using it are correct on first paint.
      // On iOS PWA cold-start, 100dvh can be briefly wrong before the viewport settles.
      (function() {
        function setVh() {
          document.documentElement.style.setProperty('--real-vh', window.innerHeight + 'px');
        }
        setVh();
        window.addEventListener('resize', setVh);
      })();

      // Detect stale iOS PWA cache: compare build-id.txt (always fetched from network)
      // against the last known value in localStorage. If different, the browser has a
      // stale index.html → force reload once so it picks up the new build.
      (function() {
        if (sessionStorage.getItem('_brel')) return; // already reloaded this session
        var stored = localStorage.getItem('_sbid');
        fetch('/build-id.txt?_=' + Date.now(), { cache: 'no-store' })
          .then(function(r) { return r.ok ? r.text() : null; })
          .then(function(id) {
            if (!id) return;
            id = id.trim();
            if (stored && stored !== id) {
              localStorage.setItem('_sbid', id);
              sessionStorage.setItem('_brel', '1');
              location.reload();
            } else {
              localStorage.setItem('_sbid', id);
            }
          })
          .catch(function() {});
      })();

      // Polyfills for Safari < 15.4
      if (!Object.hasOwn) {
        Object.hasOwn = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
      }
      if (!Array.prototype.at) {
        Array.prototype.at = function(n) {
          n = Math.trunc(n) || 0;
          if (n < 0) n += this.length;
          return (n < 0 || n >= this.length) ? undefined : this[n];
        };
      }
      if (!String.prototype.at) {
        String.prototype.at = function(n) {
          n = Math.trunc(n) || 0;
          if (n < 0) n += this.length;
          return (n < 0 || n >= this.length) ? undefined : this[n];
        };
      }
      if (!Array.prototype.findLast) {
        Array.prototype.findLast = function(fn) {
          for (var i = this.length - 1; i >= 0; i--) {
            if (fn(this[i], i, this)) return this[i];
          }
        };
        Array.prototype.findLastIndex = function(fn) {
          for (var i = this.length - 1; i >= 0; i--) {
            if (fn(this[i], i, this)) return i;
          }
          return -1;
        };
      }
      if (typeof structuredClone === 'undefined') {
        window.structuredClone = function(o) { return JSON.parse(JSON.stringify(o)); };
      }
      if (typeof BroadcastChannel === 'undefined') {
        window.BroadcastChannel = function(name) { this.name = name; };
        window.BroadcastChannel.prototype.postMessage = function() {};
        window.BroadcastChannel.prototype.close = function() {};
        window.BroadcastChannel.prototype.addEventListener = function() {};
        window.BroadcastChannel.prototype.removeEventListener = function() {};
        window.BroadcastChannel.prototype.dispatchEvent = function() { return true; };
      }

      window.addEventListener('error', function(e) {
        var el = document.getElementById('boot-msg');
        if (el) {
          el.innerHTML = '<span style="color:#f87171;font-size:14px;text-align:center;padding:20px">JS Error: ' + (e.message || 'unknown') + '<br><small style="color:#6b7280">' + (e.filename||'') + ':' + (e.lineno||'') + '</small></span>';
        }
      });
      window.addEventListener('unhandledrejection', function(e) {
        var el = document.getElementById('boot-msg');
        if (el && el.id === 'boot-msg') {
          el.innerHTML = '<span style="color:#f87171;font-size:14px;text-align:center;padding:20px">Promise Error: ' + (e.reason || 'unknown') + '</span>';
        }
      });
