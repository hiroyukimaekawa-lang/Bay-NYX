/**
 * Bay NYX - microCMS bootstrap + CAST promotional videos
 *
 * Existing microCMS rendering lives in cms-content-core.js.
 * This bootstrap keeps that behavior intact and adds two optional videos
 * to the .cast section. The current cast video remains as a fallback until
 * both replacement files are available.
 */
(function () {
  'use strict';

  var CAST_VIDEOS = [
    { src: 'img/cast/cast-video-01.mp4', label: 'Bay NYX キャスト動画 1' },
    { src: 'img/cast/cast-video-02.mp4', label: 'Bay NYX キャスト動画 2' },
  ];

  function loadCore() {
    var core = document.createElement('script');
    core.src = 'cms-content-core.js';
    core.async = false;
    core.addEventListener('error', function () {
      console.warn('[cms-content] cms-content-core.js を読み込めませんでした。');
    });
    document.head.appendChild(core);
  }

  function injectCastVideoStyles() {
    if (document.getElementById('castVideoStyles')) return;

    var style = document.createElement('style');
    style.id = 'castVideoStyles';
    style.textContent = [
      '.cast-video-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;max-width:760px;margin:0 auto 30px;}',
      '.cast-video-grid[hidden]{display:none!important;}',
      '.cast-video-slot{margin:0;border-radius:14px;overflow:hidden;border:1px solid var(--line);aspect-ratio:9/16;background:#10151d;}',
      '.cast-video-slot video{width:100%;height:100%;object-fit:cover;display:block;}',
      '@media (max-width:720px){.cast-video-grid{grid-template-columns:1fr;max-width:420px;gap:14px;}}',
    ].join('');
    document.head.appendChild(style);
  }

  function createCastVideo(item) {
    var figure = document.createElement('figure');
    figure.className = 'cast-video-slot';

    var video = document.createElement('video');
    video.setAttribute('src', item.src);
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('preload', 'metadata');
    video.setAttribute('aria-label', item.label);
    video.muted = true;

    figure.appendChild(video);
    return { figure: figure, video: video };
  }

  function initCastVideos() {
    var castSection = document.querySelector('section.cast#cast');
    if (!castSection || document.getElementById('castVideoGrid')) return;

    var container = castSection.querySelector('.container');
    var fallback = container && container.querySelector('.cast-photo');
    if (!container || !fallback) return;

    injectCastVideoStyles();

    var grid = document.createElement('div');
    grid.id = 'castVideoGrid';
    grid.className = 'cast-video-grid fade';
    grid.hidden = true;
    grid.setAttribute('aria-label', 'Bay NYX キャスト動画');

    var readyCount = 0;
    CAST_VIDEOS.forEach(function (item) {
      var built = createCastVideo(item);
      var ready = false;

      built.video.addEventListener('loadedmetadata', function () {
        if (ready) return;
        ready = true;
        readyCount += 1;

        if (readyCount === CAST_VIDEOS.length) {
          fallback.hidden = true;
          grid.hidden = false;
          grid.classList.add('show');

          grid.querySelectorAll('video').forEach(function (video) {
            var playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(function () {});
            }
          });
        }
      }, { once: true });

      built.video.addEventListener('error', function () {
        console.info('[cast-videos] 動画待機中:', item.src);
      }, { once: true });

      grid.appendChild(built.figure);
    });

    fallback.insertAdjacentElement('afterend', grid);
  }

  function init() {
    initCastVideos();
    loadCore();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
