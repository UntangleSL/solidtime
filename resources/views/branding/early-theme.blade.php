{{--
    Untangle fork (phase 03.2, BRAND-01/BRAND-02): pre-paint theme and accent.

    Included at the top of <head> in resources/views/app.blade.php (Inertia root view) and
    resources/views/auth/oauth/authorize.blade.php, before any stylesheet or bundle, so the
    light/dark class and the accent-<id> class are on <html> before the first paint.

    Order of precedence: the signed-in user's stored value (server) > localStorage > default
    (theme "system", accent "untangle"). Theme "system" resolves to light only when the OS asks
    for light; otherwise dark, so a browser with no preference gets dark (D-02, same as
    resources/js/utils/theme.ts). Unknown values fall back silently.

    The payload holds only allow-listed values (re-validated by AppearanceResolver) and is printed
    with Laravel's Js helper (hex-escaped). The logic script below contains no Blade expression on purpose:
    resources/js/branding/bootScript.test.ts executes it as shipped.
--}}
@inject('appearanceResolver', 'App\Appearance\AppearanceResolver')
<script>window.__APPEARANCE__ = {{ \Illuminate\Support\Js::from($appearanceResolver->bootPayload()) }};</script>
<script data-early-theme>
(function () {
    try {
        var cfg = window.__APPEARANCE__ || {};
        var root = document.documentElement;
        var THEMES = ['system', 'light', 'dark'];
        var ACCENTS = Object.prototype.toString.call(cfg.accents) === '[object Array]' ? cfg.accents : [];
        var LIGHT_QUERY = '(prefers-color-scheme: light)';
        var current = { theme: 'system', accent: 'untangle' };

        function storage() {
            try {
                return window.localStorage || null;
            } catch (e) {
                return null;
            }
        }
        function readStored(key) {
            try {
                var store = storage();
                return store ? store.getItem(key) : null;
            } catch (e) {
                return null;
            }
        }
        function writeStored(key, value) {
            try {
                var store = storage();
                if (store) {
                    store.setItem(key, value);
                }
            } catch (e) {
                /* storage unavailable: the classes are still applied */
            }
        }
        function allowed(list, value) {
            return typeof value === 'string' && list.indexOf(value) !== -1;
        }
        function pick(serverValue, key, list, fallback) {
            if (allowed(list, serverValue)) {
                return serverValue;
            }
            var stored = readStored(key);
            return allowed(list, stored) ? stored : fallback;
        }
        function lightQuery() {
            try {
                return typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null;
            } catch (e) {
                return null;
            }
        }
        function resolveMode(theme) {
            if (theme !== 'system') {
                return theme;
            }
            var query = lightQuery();
            return query && query.matches ? 'light' : 'dark';
        }
        function apply() {
            var mode = resolveMode(current.theme);
            root.classList.remove('light', 'dark');
            root.classList.add(mode);
            for (var i = 0; i < ACCENTS.length; i++) {
                if (ACCENTS[i] !== current.accent) {
                    root.classList.remove('accent-' + ACCENTS[i]);
                }
            }
            if (allowed(ACCENTS, current.accent)) {
                root.classList.add('accent-' + current.accent);
            }
        }

        current.theme = pick(cfg.theme, 'theme', THEMES, 'system');
        current.accent = pick(cfg.accent, 'accent', ACCENTS, 'untangle');
        apply();

        if (allowed(THEMES, cfg.theme)) {
            writeStored('theme', cfg.theme);
        }
        if (allowed(ACCENTS, cfg.accent)) {
            writeStored('accent', cfg.accent);
        }

        window.addEventListener('storage', function (event) {
            try {
                if (event.key !== null && event.key !== 'theme' && event.key !== 'accent') {
                    return;
                }
                current.theme = pick(null, 'theme', THEMES, 'system');
                current.accent = pick(null, 'accent', ACCENTS, 'untangle');
                apply();
            } catch (e) {
                /* never break the page */
            }
        });

        var query = lightQuery();
        var onSchemeChange = function () {
            try {
                if (current.theme === 'system') {
                    apply();
                }
            } catch (e) {
                /* never break the page */
            }
        };
        if (query && typeof query.addEventListener === 'function') {
            query.addEventListener('change', onSchemeChange);
        } else if (query && typeof query.addListener === 'function') {
            query.addListener(onSchemeChange);
        }
    } catch (e) {
        /* never block rendering */
    }
})();
</script>
