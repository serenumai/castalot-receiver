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
  let hlsStatusInterval = null;

  function setPlayerVisible(visible) {
    const player = document.getElementById('player');
    if (!player) return;
    player.style.display = visible ? '' : 'none';
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
      // Broadcast status periodically so sender sees correct position/duration
      startHlsStatusBroadcast();
    }).catch(function(error) {
      console.error('[Castalot] Shaka load failed:', error);
      hlsModeActive = false;
      setShakaVideoVisible(false);
    });
  }

  function stopShakaPlayback() {
    hlsModeActive = false;
    stopHlsStatusBroadcast();
    if (shakaPlayer) {
      shakaPlayer.destroy();
      shakaPlayer = null;
    }
    if (shakaVideoEl) {
      shakaVideoEl.classList.add('hidden');
    }
  }

  function startHlsStatusBroadcast() {
    stopHlsStatusBroadcast();
    hlsStatusInterval = setInterval(function() {
      if (hlsModeActive) {
        try { playerManager.broadcastStatus(true); } catch(e) { /* ignore */ }
      }
    }, 1000);
  }

  function stopHlsStatusBroadcast() {
    if (hlsStatusInterval) {
      clearInterval(hlsStatusInterval);
      hlsStatusInterval = null;
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
    console.log('[Castalot] rotation queued: ' + deg + 'deg');
  }

  function applyPendingRotation() {
    var deg = pendingRotation;
    if (deg === 0) return;
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

  // MARK: - LOAD interceptor

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

      // HLS mode: use Shaka Player for playback, CAF for media session
      if (customData && customData.hlsMode === true && customData.hlsUrl) {
        console.log('[Castalot] HLS mode — Shaka + CAF bridge: ' + customData.hlsUrl);
        hideSplash();
        startShakaPlayback(customData.hlsUrl);

        // Return loadRequestData so CAF creates a media session (for controls).
        // CAF's native player will fail to play Apple fMP4, but we override
        // MEDIA_STATUS to report Shaka's state instead.
        loadRequestData.media.contentUrl = customData.hlsUrl;
        loadRequestData.media.contentType = 'application/x-mpegURL';
        return loadRequestData;
      }

      // Non-HLS: stop any active Shaka playback and use default CAF player
      stopShakaPlayback();
      hideSplash();
      return loadRequestData;
    }
  );

  // MARK: - Media status bridge: override CAF status with Shaka state

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.MEDIA_STATUS,
    (statusMessage) => {
      if (!hlsModeActive || !shakaVideoEl) return statusMessage;

      var dur = shakaVideoEl.duration;
      var pos = shakaVideoEl.currentTime;
      var hasDuration = !isNaN(dur) && dur > 0;

      if (hasDuration && statusMessage.status && statusMessage.status.length > 0) {
        var s = statusMessage.status[0];
        // Override player state with Shaka's actual state
        if (shakaVideoEl.paused) {
          s.playerState = cast.framework.messages.PlayerState.PAUSED;
        } else {
          s.playerState = cast.framework.messages.PlayerState.PLAYING;
        }
        s.currentTime = pos;
        if (s.media) {
          s.media.duration = dur;
        }
      }
      return statusMessage;
    }
  );

  // MARK: - Control bridges: forward SEEK/PAUSE/PLAY to Shaka

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.SEEK,
    (seekData) => {
      if (hlsModeActive && shakaVideoEl) {
        console.log('[Castalot] HLS seek to ' + seekData.currentTime);
        shakaVideoEl.currentTime = seekData.currentTime || 0;
        try { playerManager.broadcastStatus(true); } catch(e) { /* ignore */ }
        return null; // Handled by Shaka
      }
      return seekData;
    }
  );

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.PAUSE,
    (data) => {
      if (hlsModeActive && shakaVideoEl) {
        console.log('[Castalot] HLS pause');
        shakaVideoEl.pause();
        try { playerManager.broadcastStatus(true); } catch(e) { /* ignore */ }
        return null;
      }
      return data;
    }
  );

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.PLAY,
    (data) => {
      if (hlsModeActive && shakaVideoEl) {
        console.log('[Castalot] HLS play');
        shakaVideoEl.play();
        try { playerManager.broadcastStatus(true); } catch(e) { /* ignore */ }
        return null;
      }
      return data;
    }
  );

  // MARK: - CAF events

  playerManager.addEventListener(
    cast.framework.events.EventType.PLAYER_LOAD_COMPLETE,
    () => {
      const data = playerManager.getMediaInformation();
      if (data && data.customData) {
        applyWatermarkFromCustomData(data.customData);
      }
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
        // Don't show splash if Shaka is active (CAF might report IDLE due to load failure)
        if (hlsModeActive) return;
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
