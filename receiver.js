/* global cast */
(() => {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const watermarkEl = document.getElementById('watermark');
  const watermarkTextEl = watermarkEl ? watermarkEl.querySelector('span') : null;
  const splashEl = document.getElementById('splash');
  const slideshowEl = document.getElementById('slideshow');
  let splashVisible = false;
  let watermarkEnabledState = false;
  let slideshowActive = false;
  let slideshowTimer = null;
  let slideshowUrls = [];
  let slideshowIndex = 0;
  let slideshowIntervalMs = 5000;

  function showSplash() {
    if (slideshowActive) return;
    if (!splashEl) return;
    splashEl.classList.remove('hidden');
    splashEl.classList.add('visible');
    splashVisible = true;
    setWatermarkVisible(false);
  }

  function hideSplash() {
    if (!splashEl) return;
    splashEl.classList.remove('visible');
    window.setTimeout(() => splashEl.classList.add('hidden'), 220);
    splashVisible = false;
    setWatermarkVisible(watermarkEnabledState);
  }

  function setWatermarkVisible(visible) {
    if (!watermarkEl) return;
    const shouldShow = visible && !splashVisible;
    watermarkEl.classList.toggle('hidden', !shouldShow);
  }

  function showSlideshow() {
    if (!slideshowEl) return;
    slideshowEl.classList.remove('hidden');
  }

  function hideSlideshow() {
    if (!slideshowEl) return;
    slideshowEl.classList.add('hidden');
  }

  function stopSlideshow() {
    slideshowActive = false;
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    slideshowUrls = [];
    slideshowIndex = 0;
    hideSlideshow();
    const player = document.getElementById('player');
    if (player) player.style.display = '';
  }

  function startSlideshow(urls, intervalSeconds) {
    if (!slideshowEl || !Array.isArray(urls) || urls.length === 0) return;
    stopSlideshow();
    slideshowActive = true;
    slideshowUrls = urls;
    slideshowIndex = 0;
    slideshowIntervalMs = Math.max(1, Number(intervalSeconds || 5)) * 1000;
    console.log('[Castalot] slideshow start', { count: slideshowUrls.length, intervalMs: slideshowIntervalMs });
    const player = document.getElementById('player');
    if (player) player.style.display = 'none';
    showSlideshow();
    hideSplash();
    slideshowEl.src = slideshowUrls[slideshowIndex];
    slideshowTimer = setInterval(() => {
      slideshowIndex = (slideshowIndex + 1) % slideshowUrls.length;
      console.log('[Castalot] slideshow next', { index: slideshowIndex, url: slideshowUrls[slideshowIndex] });
      slideshowEl.src = slideshowUrls[slideshowIndex];
    }, slideshowIntervalMs);
  }

  function applyWatermarkFromCustomData(customData) {
    if (!customData) {
      setWatermarkVisible(false);
      return;
    }
    const enabled = Boolean(customData.watermarkEnabled);
    const text = typeof customData.watermarkText === 'string' ? customData.watermarkText : 'castalot.app';
    if (watermarkTextEl) {
      watermarkTextEl.textContent = text;
    }
    watermarkEnabledState = enabled;
    setWatermarkVisible(enabled);
  }

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD,
    (loadRequestData) => {
      applyWatermarkFromCustomData(loadRequestData && loadRequestData.customData);
      const slideshowData = loadRequestData && loadRequestData.customData && loadRequestData.customData.slideshow;
      if (slideshowData && Array.isArray(slideshowData.urls)) {
        console.log('[Castalot] slideshow customData', slideshowData);
        startSlideshow(slideshowData.urls, slideshowData.interval);
      } else {
        console.log('[Castalot] slideshow customData missing or invalid');
        stopSlideshow();
      }
      hideSplash();
      return loadRequestData;
    }
  );

  playerManager.addEventListener(
    cast.framework.events.EventType.PLAYER_LOAD_COMPLETE,
    () => {
      const data = playerManager.getMediaInformation();
      if (data && data.customData) {
        applyWatermarkFromCustomData(data.customData);
      }
      if (slideshowActive) {
        hideSplash();
      }
      hideSplash();
    }
  );

  const playerStateEvent =
    (cast.framework.events && cast.framework.events.EventType && cast.framework.events.EventType.PLAYER_STATE_CHANGED) ||
    null;
  if (playerStateEvent) {
    playerManager.addEventListener(
      playerStateEvent,
      () => {
        const state = playerManager.getPlayerState();
        if (state === cast.framework.messages.PlayerState.IDLE && !slideshowActive) {
          showSplash();
        } else {
          hideSplash();
        }
      }
    );
  }

  const readyEvent =
    (cast.framework.system && cast.framework.system.EventType && cast.framework.system.EventType.READY) ||
    (cast.framework.CastReceiverContextEventType && cast.framework.CastReceiverContextEventType.READY) ||
    null;
  if (readyEvent) {
    context.addEventListener(
      readyEvent,
      () => {
        showSplash();
      }
    );
  }

  context.start({
    disableIdleTimeout: true
  });
})();
