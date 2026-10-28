(function () {
    'use strict';

    /**
     * iOS Tweaks for Lampa
     * 1. Закрывает плеер и освобождает медиа, когда Lampa уходит в фон,
     *    чтобы iOS не держал виджет «Сейчас играет» на экране блокировки.
     * 2. Поворачивает встроенный плеер горизонтально, когда телефон держат вертикально.
     */
    var VERSION = '1.1.0';
    var LOG = '[iOS-Tweaks]';
    var DEBUG_KEY = 'ios_tweaks_debug';
    var LANDSCAPE_KEY = 'ios_tweaks_landscape';
    var ROTATED_CLASS = 'ios-tweaks-landscape';
    var BUTTON_CLASS = 'player-panel__ios-rotate';
    var MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];
    var ROTATE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M12 3a9 9 0 0 1 8 5"/><path d="M20 3v5h-5"/></svg>';

    function debug() {
        try {
            var v = Lampa.Storage.get(DEBUG_KEY, false);
            return v === true || v === 'true';
        } catch (e) {
            return false;
        }
    }

    function log() {
        if (!debug()) return;
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift(LOG);
            console.log.apply(console, args);
        } catch (e) {}
    }

    function safe(fn) {
        return function () {
            try {
                return fn.apply(this, arguments);
            } catch (e) {
                log('error', e && e.message ? e.message : e);
            }
        };
    }

    function isIOS() {
        var ua = navigator.userAgent || '';
        return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    }

    function playerOpened() {
        try {
            return !!(Lampa.Player && typeof Lampa.Player.opened === 'function' && Lampa.Player.opened());
        } catch (e) {
            return false;
        }
    }

    function videoEl() {
        try {
            return Lampa.PlayerVideo && typeof Lampa.PlayerVideo.video === 'function'
                ? Lampa.PlayerVideo.video()
                : null;
        } catch (e) {
            return null;
        }
    }

    function inPictureInPicture() {
        if (document.pictureInPictureElement) return true;

        var videos = document.getElementsByTagName('video');
        for (var i = 0; i < videos.length; i++) {
            if (videos[i].webkitPresentationMode === 'picture-in-picture') return true;
        }
        return false;
    }

    /* ---------- Очистка «Сейчас играет» ---------- */

    function clearMediaSession() {
        var session = navigator.mediaSession;
        if (!session) return;

        try { session.metadata = null; } catch (e) {}
        try { session.playbackState = 'none'; } catch (e) {}

        MEDIA_ACTIONS.forEach(function (action) {
            try { session.setActionHandler(action, null); } catch (e) {}
        });
    }

    function releaseElement(el) {
        try { el.pause(); } catch (e) {}
        try { el.srcObject = null; } catch (e) {}
        try {
            el.removeAttribute('src');
            var sources = el.getElementsByTagName('source');
            while (sources.length) sources[0].parentNode.removeChild(sources[0]);
            el.load();
        } catch (e) {}
    }

    function releaseMedia() {
        var list = document.querySelectorAll('video, audio');
        for (var i = 0; i < list.length; i++) releaseElement(list[i]);

        clearMediaSession();
        log('media released', list.length);
    }

    function onBackground(event) {
        if (event && event.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
        if (!playerOpened() || inPictureInPicture()) return;

        log('background', event && event.type);

        try {
            Lampa.Player.close();
        } catch (e) {
            log('close failed', e && e.message);
        }

        releaseMedia();
    }

    function initMediaCleanup() {
        Lampa.Player.listener.follow('destroy', safe(function () {
            if (!inPictureInPicture()) releaseMedia();
        }));

        var handler = safe(onBackground);
        document.addEventListener('visibilitychange', handler);
        document.addEventListener('freeze', handler);
        window.addEventListener('pagehide', handler);
    }

    /* ---------- Горизонтальный режим ---------- */

    // Страница повёрнута на 90° по часовой: координата X в повёрнутом виде равна clientY.
    var landscape = {
        playerActive: false,
        rotated: false,
        drag: null,
        offTimer: null
    };

    function landscapeEnabled() {
        try {
            var v = Lampa.Storage.get(LANDSCAPE_KEY, true);
            return v === true || v === 'true';
        } catch (e) {
            return true;
        }
    }

    function setLandscapeEnabled(value) {
        try { Lampa.Storage.set(LANDSCAPE_KEY, value); } catch (e) {}
    }

    function portrait() {
        return window.innerHeight > window.innerWidth;
    }

    function isNativeIosPlayer() {
        var player = document.querySelector('.player');
        return !!(player && player.classList.contains('player--ios'));
    }

    function injectStyle() {
        if (document.getElementById('ios-tweaks-style')) return;

        var style = document.createElement('style');
        style.id = 'ios-tweaks-style';
        style.textContent = [
            'html.' + ROTATED_CLASS + ', html.' + ROTATED_CLASS + ' body { overflow: hidden !important; }',
            'body.' + ROTATED_CLASS + ' {',
            '  position: fixed !important; top: 0 !important; left: 0 !important; margin: 0 !important;',
            '  width: var(--ios-tweaks-h) !important; height: var(--ios-tweaks-w) !important;',
            '  transform-origin: top left !important;',
            '  transform: translateX(var(--ios-tweaks-w)) rotate(90deg) !important;',
            '}',
            'body.' + ROTATED_CLASS + ' .player-video video { width: 100% !important; height: 100% !important; }',
            '.' + BUTTON_CLASS + ' svg { width: 1.6em; height: 1.6em; }'
        ].join('\n');

        document.head.appendChild(style);
    }

    function updateSize() {
        var root = document.documentElement.style;
        root.setProperty('--ios-tweaks-w', window.innerWidth + 'px');
        root.setProperty('--ios-tweaks-h', window.innerHeight + 'px');
    }

    function updateButton() {
        var button = document.querySelector('.' + BUTTON_CLASS);
        if (!button) return;

        button.style.display = portrait() ? '' : 'none';
        button.classList.toggle('active', landscape.rotated);
    }

    function applyRotation() {
        var need = landscape.playerActive && landscapeEnabled() && portrait() && !isNativeIosPlayer();

        if (need) updateSize();

        if (need !== landscape.rotated) {
            landscape.rotated = need;
            landscape.drag = null;

            document.documentElement.classList.toggle(ROTATED_CLASS, need);
            document.body.classList.toggle(ROTATED_CLASS, need);

            // Lampa пересчитывает размер видео по resize.
            window.dispatchEvent(new Event('resize'));
            log('landscape', need);
        }

        updateButton();
    }

    function toggleLandscape() {
        setLandscapeEnabled(!landscapeEnabled());
        applyRotation();
    }

    function ensureButton() {
        var panel = document.querySelector('.player-panel__right.player-panel__mobile-visible')
            || document.querySelector('.player-panel__right');

        if (!panel || panel.querySelector('.' + BUTTON_CLASS)) return;

        var button = document.createElement('div');
        button.className = BUTTON_CLASS + ' button selector';
        button.innerHTML = ROTATE_ICON;
        button.addEventListener('click', safe(function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleLandscape();
        }));

        panel.insertBefore(button, panel.firstChild);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function formatTime(seconds) {
        seconds = Math.max(0, Math.floor(seconds));
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = seconds % 60;
        var mm = (h && m < 10 ? '0' : '') + m;
        return (h ? h + ':' : '') + mm + ':' + (s < 10 ? '0' : '') + s;
    }

    // Lampa делит экран на трети по clientX и window.innerWidth: передаём ей координаты повёрнутого вида.
    function onCaptureClick(e) {
        if (!landscape.rotated || !e.isTrusted) return;

        var target = e.target;
        if (!target || !target.closest || !target.closest('.player-video')) return;

        e.stopImmediatePropagation();
        e.preventDefault();

        var w = window.innerWidth;
        var h = window.innerHeight;
        var x = e.clientY / h * w;
        var y = (w - e.clientX) / w * h;

        target.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y
        }));
    }

    // Перемотка свайпом по полосе: Lampa считает сдвиг по clientX, а в повёрнутом виде палец двигается по clientY.
    function onTouchStart(e) {
        if (!landscape.rotated || !e.target || !e.target.closest) return;
        if (!e.target.closest('.player-panel__time-touch-zone')) return;

        var video = videoEl();
        var timeline = document.querySelector('.player-panel__timeline');
        if (!video || !timeline || !(video.duration > 0)) return;

        e.stopImmediatePropagation();

        var point = e.touches[0] || e.changedTouches[0];
        var start = video.currentTime / video.duration;

        landscape.drag = {
            from: point.clientY,
            width: timeline.offsetWidth || 1,
            start: start,
            to: start,
            duration: video.duration
        };
    }

    function onTouchMove(e) {
        var drag = landscape.drag;
        if (!drag) return;

        e.stopImmediatePropagation();

        var point = e.touches[0] || e.changedTouches[0];
        drag.to = clamp(drag.start + (point.clientY - drag.from) / drag.width, 0, 1);

        var video = videoEl();
        if (video) video.rewind = true;

        var position = document.querySelector('.player-panel__position');
        if (position) position.style.width = (drag.to * 100) + '%';

        var timenow = document.querySelector('.player-panel__timenow');
        if (timenow) timenow.textContent = formatTime(drag.to * drag.duration);
    }

    function onTouchEnd(e) {
        var drag = landscape.drag;
        if (!drag) return;

        e.stopImmediatePropagation();
        landscape.drag = null;

        var video = videoEl();
        if (video) video.rewind = false;
        if (e.type === 'touchcancel') return;

        var seconds = drag.to * drag.duration;

        if (Lampa.PlayerVideo && typeof Lampa.PlayerVideo.to === 'function') Lampa.PlayerVideo.to(seconds);
        else if (video) video.currentTime = seconds;
    }

    function onPlayerStart() {
        clearTimeout(landscape.offTimer);
        landscape.playerActive = true;

        setTimeout(safe(function () {
            ensureButton();
            applyRotation();
        }), 0);
    }

    function onPlayerDestroy() {
        landscape.playerActive = false;

        // При переключении серии плеер пересоздаётся: не выпрямляем экран между сериями.
        clearTimeout(landscape.offTimer);
        landscape.offTimer = setTimeout(safe(function () {
            if (!landscape.playerActive) applyRotation();
        }), 300);
    }

    function initLandscape() {
        injectStyle();

        Lampa.Player.listener.follow('start', safe(onPlayerStart));
        Lampa.Player.listener.follow('destroy', safe(onPlayerDestroy));

        var resize = safe(applyRotation);
        window.addEventListener('resize', resize);
        window.addEventListener('orientationchange', resize);

        var capture = { capture: true, passive: true };
        document.addEventListener('click', safe(onCaptureClick), true);
        document.addEventListener('touchstart', safe(onTouchStart), capture);
        document.addEventListener('touchmove', safe(onTouchMove), capture);
        document.addEventListener('touchend', safe(onTouchEnd), capture);
        document.addEventListener('touchcancel', safe(onTouchEnd), capture);
    }

    function bind() {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener) {
            setTimeout(bind, 500);
            return;
        }

        initMediaCleanup();
        initLandscape();

        try {
            console.log(LOG, 'v' + VERSION);
        } catch (e) {}
    }

    if (!window.ios_tweaks_loaded && isIOS()) {
        window.ios_tweaks_loaded = true;
        bind();
    }
})();
