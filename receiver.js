/* global cast */
(() => {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const watermarkEl = document.getElementById('watermark');
  const watermarkTextEl = watermarkEl ? watermarkEl.querySelector('span') : null;
  const splashEl = document.getElementById('splash');
  const slideshowEl = document.getElementById('slideshow');
  const slideshowNamespace = 'urn:x-cast:ai.serenum.castalot.slideshow';
  let splashVisible = false;
  let watermarkEnabledState = false;
  let slideshowActive = false;
  let slideshowTimer = null;
  let slideshowUrls = [];
  let slideshowIndex = 0;
  let slideshowIntervalMs = 5000;

  function setPlayerVisible(visible) {
    const player = document.getElementById('player');
    if (!player) return;
    player.style.display = visible ? '' : 'none';
  }

  function showSplash() {
    if (slideshowActive) return;
    if (!splashEl) return;
    splashEl.classList.remove('hidden');
    splashEl.classList.add('visible');
    splashVisible = true;
    setWatermarkVisible(false);
    setPlayerVisible(false);
  }

  function hideSplash() {
    if (!splashEl) return;
    splashEl.classList.remove('visible');
    window.setTimeout(() => splashEl.classList.add('hidden'), 220);
    splashVisible = false;
    setWatermarkVisible(watermarkEnabledState);
    if (!slideshowActive) {
      setPlayerVisible(true);
    }
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
    setPlayerVisible(true);
  }

  function startSlideshow(urls, intervalSeconds) {
    if (!slideshowEl || !Array.isArray(urls) || urls.length === 0) return;
    stopSlideshow();
    slideshowActive = true;
    slideshowUrls = urls;
    slideshowIndex = 0;
    slideshowIntervalMs = Math.max(1, Number(intervalSeconds || 5)) * 1000;
    console.log('[Castalot] slideshow start', { count: slideshowUrls.length, intervalMs: slideshowIntervalMs });
    setPlayerVisible(false);
    showSlideshow();
    hideSplash();
    slideshowEl.src = slideshowUrls[slideshowIndex];
    sendSlideshowStatus();
    slideshowTimer = setInterval(() => {
      slideshowIndex = (slideshowIndex + 1) % slideshowUrls.length;
      console.log('[Castalot] slideshow next', { index: slideshowIndex, url: slideshowUrls[slideshowIndex] });
      slideshowEl.src = slideshowUrls[slideshowIndex];
      sendSlideshowStatus();
    }, slideshowIntervalMs);
  }

  function sendSlideshowStatus() {
    if (!slideshowActive) return;
    const senders = context.getSenders();
    if (!senders || senders.length === 0) return;
    const payload = {
      type: 'slideshowStatus',
      index: slideshowIndex,
      total: slideshowUrls.length
    };
    senders.forEach((sender) => {
      try {
        context.sendCustomMessage(slideshowNamespace, sender.senderId, payload);
      } catch (err) {
        console.warn('[Castalot] slideshow status send failed', err);
      }
    });
  }

  context.addCustomMessageListener(slideshowNamespace, (event) => {
    const data = event && event.data;
    if (!data || data.type !== 'slideshowStatusRequest') return;
    sendSlideshowStatus();
  });

  let pendingRotation = 0;

  function applyVideoRotation(degrees) {
    const player = document.getElementById('player');
    if (!player) return;
    const deg = Number(degrees) || 0;
    pendingRotation = deg;
    if (deg === 0) {
      player.style.cssText = player.style.cssText.replace(/transform:[^;]+;?/g, '');
      clearVideoRotation(player);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const needsScale = (deg === 90 || deg === 270);
    const scale = needsScale ? (Math.min(vw, vh) / Math.max(vw, vh)) : 1;
    const transformValue = 'rotate(' + deg + 'deg) scale(' + scale + ')';

    // Apply to the cast-media-player host element
    player.style.setProperty('transform', transformValue, 'important');
    player.style.setProperty('transform-origin', 'center center', 'important');

    // Also try to reach the video element inside shadow DOM
    applyToShadowVideo(player, transformValue);

    console.log('[Castalot] applied video rotation: ' + deg + 'deg, scale: ' + scale);
  }

  function applyToShadowVideo(player, transformValue) {
    try {
      var root = player.shadowRoot;
      if (!root) {
        console.log('[Castalot] no shadowRoot on player');
        return;
      }
      var video = root.querySelector('video');
      if (video) {
        video.style.setProperty('transform', transformValue, 'important');
        video.style.setProperty('transform-origin', 'center center', 'important');
        console.log('[Castalot] applied rotation to shadow DOM video');
      } else {
        console.log('[Castalot] no video in shadowRoot, will retry');
        // Video might not be created yet - observe for it
        var observer = new MutationObserver(function() {
          var v = root.querySelector('video');
          if (v) {
            v.style.setProperty('transform', transformValue, 'important');
            v.style.setProperty('transform-origin', 'center center', 'important');
            console.log('[Castalot] applied rotation to shadow DOM video (deferred)');
            observer.disconnect();
          }
        });
        observer.observe(root, { childList: true, subtree: true });
      }
    } catch (err) {
      console.warn('[Castalot] shadow DOM rotation failed', err);
    }
  }

  function clearVideoRotation(player) {
    try {
      var root = player.shadowRoot;
      if (!root) return;
      var video = root.querySelector('video');
      if (video) {
        video.style.removeProperty('transform');
        video.style.removeProperty('transform-origin');
      }
    } catch (err) { /* ignore */ }
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
      const customData = loadRequestData && loadRequestData.customData;
      applyWatermarkFromCustomData(customData);
      applyVideoRotation(customData && customData.videoRotation);
      const slideshowData = customData && customData.slideshow;
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
      // Re-apply rotation after player finishes loading (SDK may reset styles)
      if (pendingRotation !== 0) {
        console.log('[Castalot] re-applying rotation after PLAYER_LOAD_COMPLETE');
        applyVideoRotation(pendingRotation);
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
