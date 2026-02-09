/* global cast, shaka */
(() => {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const watermarkEl = document.getElementById('watermark');
  const watermarkTextEl = watermarkEl ? watermarkEl.querySelector('span') : null;
  const splashEl = document.getElementById('splash');
  const slideshowEl = document.getElementById('slideshow');
  const fileHashEl = document.getElementById('fileHash');
  const shakaVideoEl = document.getElementById('shakaVideo');
  const slideshowNamespace = 'urn:x-cast:ai.serenum.castalot.slideshow';
  let splashVisible = false;
  let watermarkEnabledState = false;
  let slideshowActive = false;
  let slideshowTimer = null;
  let slideshowUrls = [];
  let slideshowIndex = 0;
  let slideshowIntervalMs = 5000;
  let shakaPlayer = null;
  let hlsModeActive = false;

  function setPlayerVisible(visible) {
    const player = document.getElementById('player');
    if (!player) return;
    player.style.display = visible ? '' : 'none';
    // When showing CAF player, hide Shaka video and vice versa
    if (shakaVideoEl) {
      shakaVideoEl.classList.toggle('hidden', visible || !hlsModeActive);
    }
  }

  function setShakaVideoVisible(visible) {
    if (!shakaVideoEl) return;
    shakaVideoEl.classList.toggle('hidden', !visible);
    // Hide CAF player when Shaka is active
    const player = document.getElementById('player');
    if (player) {
      player.style.display = visible ? 'none' : '';
    }
  }

  function startShakaPlayback(hlsUrl) {
    if (!shakaVideoEl || typeof shaka === 'undefined') {
      console.error('[Castalot] Shaka Player not available');
      return;
    }

    // Clean up previous instance
    stopShakaPlayback();

    shaka.polyfill.installAll();
    shakaPlayer = new shaka.Player();
    shakaPlayer.attach(shakaVideoEl);

    shakaPlayer.configure({
      streaming: {
        bufferingGoal: 10,
        rebufferingGoal: 2,
        bufferBehind: 30,
        retryParameters: {
          maxAttempts: 5,
          baseDelay: 500,
          backoffFactor: 1.5,
          fuzzFactor: 0.5
        }
      }
    });

    shakaPlayer.addEventListener('error', function(event) {
      console.error('[Castalot] Shaka error:', event.detail);
    });

    hlsModeActive = true;
    setShakaVideoVisible(true);

    shakaPlayer.load(hlsUrl).then(function() {
      console.log('[Castalot] Shaka HLS loaded:', hlsUrl);
      shakaVideoEl.play();
      hideSplash();
    }).catch(function(error) {
      console.error('[Castalot] Shaka load failed:', error);
      hlsModeActive = false;
      setShakaVideoVisible(false);
    });
  }

  function stopShakaPlayback() {
    hlsModeActive = false;
    if (shakaPlayer) {
      shakaPlayer.destroy();
      shakaPlayer = null;
    }
    if (shakaVideoEl) {
      shakaVideoEl.classList.add('hidden');
    }
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
    const deg = Number(degrees) || 0;
    pendingRotation = deg;
    // Don't apply during LOAD — wait for PLAYER_LOAD_COMPLETE
    console.log('[Castalot] rotation queued: ' + deg + 'deg');
  }

  function applyPendingRotation() {
    var deg = pendingRotation;
    if (deg === 0) return;
    // CSS transforms cannot rotate video on Android TV hardware overlay.
    // filter:brightness(1) forces software compositing but makes video invisible.
    // Rotation is handled by the sender (iOS) during remux/transcode instead.
    console.log('[Castalot] rotation ' + deg + 'deg — handled by sender, no CSS rotation applied');
  }

  function applyFileHash(customData) {
    if (!fileHashEl) return;
    var hash = customData && typeof customData.fileHash === 'string' ? customData.fileHash : '';
    if (hash) {
      fileHashEl.textContent = hash;
      fileHashEl.classList.remove('hidden');
      console.log('[Castalot] fileHash: ' + hash);
    } else {
      fileHashEl.classList.add('hidden');
    }
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
      applyFileHash(customData);
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

      // HLS mode: use Shaka Player instead of default CAF player
      if (customData && customData.hlsMode === true && customData.hlsUrl) {
        console.log('[Castalot] HLS mode — using Shaka Player: ' + customData.hlsUrl);
        hideSplash();
        startShakaPlayback(customData.hlsUrl);
        // Return null to cancel default CAF load — Shaka handles playback
        return null;
      }

      // Non-HLS: stop any active Shaka playback and use default CAF player
      stopShakaPlayback();
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
      // Apply rotation after media is fully loaded
      if (pendingRotation !== 0) {
        console.log('[Castalot] applying rotation after PLAYER_LOAD_COMPLETE');
        applyPendingRotation();
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
