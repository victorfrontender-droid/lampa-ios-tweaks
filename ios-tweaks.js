(function () {
    'use strict';

    /**
     * iOS Tweaks for Lampa
     * Закрывает плеер и освобождает медиа, когда Lampa уходит в фон,
     * чтобы iOS не держал виджет «Сейчас играет» на экране блокировки.
     */
    var VERSION = '1.0.0';
    var LOG = '[iOS-Tweaks]';
    var DEBUG_KEY = 'ios_tweaks_debug';
    var MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'];

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

    function inPictureInPicture() {
        if (document.pictureInPictureElement) return true;

        var videos = document.getElementsByTagName('video');
        for (var i = 0; i < videos.length; i++) {
            if (videos[i].webkitPresentationMode === 'picture-in-picture') return true;
        }
        return false;
    }

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

    function bind() {
        if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener) {
            setTimeout(bind, 500);
            return;
        }

        Lampa.Player.listener.follow('destroy', safe(function () {
            if (!inPictureInPicture()) releaseMedia();
        }));

        var handler = safe(onBackground);
        document.addEventListener('visibilitychange', handler);
        document.addEventListener('freeze', handler);
        window.addEventListener('pagehide', handler);

        try {
            console.log(LOG, 'v' + VERSION);
        } catch (e) {}
    }

    if (!window.ios_tweaks_loaded && isIOS()) {
        window.ios_tweaks_loaded = true;
        bind();
    }
})();
