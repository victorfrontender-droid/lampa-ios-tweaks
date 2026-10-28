(function () {
    'use strict';

    /**
     * iOS Tweaks for Lampa
     * 1. Закрывает плеер и освобождает медиа, когда Lampa уходит в фон,
     *    чтобы iOS не держал виджет «Сейчас играет» на экране блокировки.
     * 2. Добавляет во встроенный плеер кнопку системного полноэкранного режима iOS.
     */
    var VERSION = '1.2.0';
    var LOG = '[iOS-Tweaks]';
    var DEBUG_KEY = 'ios_tweaks_debug';
    var BUTTON_CLASS = 'player-panel__ios-fullscreen';
    var MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];
    // Вход в системный полный экран может на мгновение скрыть страницу: в это время не закрываем плеер.
    var FULLSCREEN_GRACE_MS = 2000;
    var FULLSCREEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>';

    var fullscreen = {
        enteredAt: 0,
        ours: false
    };

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
        if (Date.now() - fullscreen.enteredAt < FULLSCREEN_GRACE_MS) return;

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

    /* ---------- Кнопка полноэкранного режима ---------- */

    function enterFullscreen() {
        var video = videoEl();
        if (!video || typeof video.webkitEnterFullscreen !== 'function') return;

        fullscreen.enteredAt = Date.now();
        fullscreen.ours = true;

        try {
            video.webkitEnterFullscreen();
            log('fullscreen enter');
        } catch (e) {
            fullscreen.ours = false;
            log('fullscreen failed', e && e.message);
            try {
                if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Полноэкранный режим недоступен, подождите загрузки видео');
            } catch (e2) {}
        }
    }

    // Lampa закрывает плеер по webkitendfullscreen: после выхода из нашего полного экрана продолжаем во встроенном.
    function onFullscreenEnd(e) {
        if (!fullscreen.ours) return;
        if (!e.target || e.target.tagName !== 'VIDEO') return;

        fullscreen.ours = false;
        e.stopImmediatePropagation();
        log('fullscreen exit');
    }

    function ensureButton() {
        var panel = document.querySelector('.player-panel__right.player-panel__mobile-visible')
            || document.querySelector('.player-panel__right');

        if (!panel || panel.querySelector('.' + BUTTON_CLASS)) return;

        var button = document.createElement('div');
        button.className = BUTTON_CLASS + ' button selector';
        button.innerHTML = FULLSCREEN_ICON;
        button.addEventListener('click', safe(function (e) {
            e.preventDefault();
            e.stopPropagation();
            enterFullscreen();
        }));

        panel.insertBefore(button, panel.firstChild);
    }

    function injectStyle() {
        if (document.getElementById('ios-tweaks-style')) return;

        var style = document.createElement('style');
        style.id = 'ios-tweaks-style';
        style.textContent = '.' + BUTTON_CLASS + ' svg { width: 1.6em; height: 1.6em; }';
        document.head.appendChild(style);
    }

    function initFullscreenButton() {
        injectStyle();

        Lampa.Player.listener.follow('start', safe(function () {
            fullscreen.ours = false;
            setTimeout(safe(ensureButton), 0);
        }));

        document.addEventListener('webkitendfullscreen', safe(onFullscreenEnd), true);
    }

    function bind() {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener) {
            setTimeout(bind, 500);
            return;
        }

        initMediaCleanup();
        initFullscreenButton();

        try {
            console.log(LOG, 'v' + VERSION);
        } catch (e) {}
    }

    if (!window.ios_tweaks_loaded && isIOS()) {
        window.ios_tweaks_loaded = true;
        bind();
    }
})();
