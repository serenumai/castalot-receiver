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
  let hlsTitle = '';
  let hlsTotalDuration = 0;
  let hlsControlsAutoHideTimer = null;
  const hlsControlsEl = document.getElementById('hlsControls');
  const hlsTitleEl = document.getElementById('hlsTitle');
  const hlsPlayPauseEl = document.getElementById('hlsPlayPause');
  const hlsCurrentTimeEl = document.getElementById('hlsCurrentTime');
  const hlsDurationEl = document.getElementById('hlsDuration');
  const hlsProgressFillEl = document.getElementById('hlsProgressFill');

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

    document.addEventListener('keydown', onHlsKeyDown);

    shakaPlayer.load(hlsUrl).then(function() {
      console.log('[Castalot] Shaka HLS loaded:', hlsUrl);
      shakaVideoEl.play();
      hideSplash();
      // Broadcast status periodically so sender sees correct position/duration
      startHlsStatusBroadcast();
      // Show controls briefly so user knows they exist
      showHlsControls();
    }).catch(function(error) {
      console.error('[Castalot] Shaka load failed:', error);
      hlsModeActive = false;
      setShakaVideoVisible(false);
    });
  }

  function stopShakaPlayback() {
    hlsModeActive = false;
    stopHlsStatusBroadcast();
    document.removeEventListener('keydown', onHlsKeyDown);
    hideHlsControls();
    hlsTitle = '';
    hlsTotalDuration = 0;
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
        updateHlsControlsUI();
      }
    }, 1000);
  }

  function stopHlsStatusBroadcast() {
    if (hlsStatusInterval) {
      clearInterval(hlsStatusInterval);
      hlsStatusInterval = null;
    }
  }

  // MARK: - HLS Controls Overlay

  function getShakaDuration() {
    // The sender passes the real total duration in customData.duration.
    // video.duration and seekRange() only reflect segments transcoded so far
    // (HLS EVENT playlist grows over time), so they're unreliable for total length.
    var pos = shakaVideoEl ? shakaVideoEl.currentTime : 0;
    if (hlsTotalDuration > 0) {
      return { position: pos, duration: hlsTotalDuration };
    }
    // Fallback: try video.duration if it's finite (e.g. after transcode completes and playlist becomes VOD)
    var d = shakaVideoEl ? shakaVideoEl.duration : NaN;
    if (isFinite(d) && d > 0) {
      return { position: pos, duration: d };
    }
    return null;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var s = Math.floor(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = sec < 10 ? '0' : '';
    if (h > 0) {
      var mpad = m < 10 ? '0' : '';
      return h + ':' + mpad + m + ':' + pad + sec;
    }
    return m + ':' + pad + sec;
  }

  function showHlsControls() {
    if (!hlsModeActive || !hlsControlsEl) return;
    hlsControlsEl.classList.remove('hidden');
    updateHlsControlsUI();
    resetHlsAutoHide();
  }

  function hideHlsControls() {
    if (!hlsControlsEl) return;
    hlsControlsEl.classList.add('hidden');
    if (hlsControlsAutoHideTimer) {
      clearTimeout(hlsControlsAutoHideTimer);
      hlsControlsAutoHideTimer = null;
    }
  }

  function resetHlsAutoHide() {
    if (hlsControlsAutoHideTimer) {
      clearTimeout(hlsControlsAutoHideTimer);
    }
    hlsControlsAutoHideTimer = setTimeout(function() {
      hideHlsControls();
    }, 5000);
  }

  function updateHlsControlsUI() {
    if (!hlsModeActive || !shakaVideoEl) return;
    var info = getShakaDuration();
    var pos = info ? info.position : 0;
    var dur = info ? info.duration : 0;
    var paused = shakaVideoEl.paused;

    if (hlsPlayPauseEl) {
      hlsPlayPauseEl.innerHTML = paused ? '&#9654;' : '&#9646;&#9646;';
    }
    if (hlsCurrentTimeEl) {
      hlsCurrentTimeEl.textContent = formatTime(pos);
    }
    if (hlsDurationEl) {
      hlsDurationEl.textContent = info ? formatTime(dur) : '--:--';
    }
    if (hlsProgressFillEl) {
      hlsProgressFillEl.style.width = (dur > 0 ? ((pos / dur) * 100).toFixed(1) : '0') + '%';
    }
    if (hlsTitleEl) {
      hlsTitleEl.textContent = hlsTitle;
    }
  }

  function onHlsKeyDown(e) {
    if (!hlsModeActive || !shakaVideoEl) return;
    var controlsVisible = hlsControlsEl && !hlsControlsEl.classList.contains('hidden');

    switch (e.keyCode) {
      case 13:  // Enter / D-pad center
      case 179: // MediaPlayPause
        if (!controlsVisible) {
          showHlsControls();
        } else {
          if (shakaVideoEl.paused) {
            shakaVideoEl.play();
          } else {
            shakaVideoEl.pause();
          }
          updateHlsControlsUI();
          resetHlsAutoHide();
        }
        e.preventDefault();
        break;
      case 37: // Left arrow — seek back 10s
        shakaVideoEl.currentTime = Math.max(0, shakaVideoEl.currentTime - 10);
        showHlsControls();
        e.preventDefault();
        break;
      case 39: // Right arrow — seek forward 10s
        var fwdInfo = getShakaDuration();
        var maxTime = fwdInfo ? fwdInfo.duration : (shakaVideoEl.duration || 0);
        shakaVideoEl.currentTime = Math.min(maxTime, shakaVideoEl.currentTime + 10);
        showHlsControls();
        e.preventDefault();
        break;
      case 415: // MediaPlay
        shakaVideoEl.play();
        showHlsControls();
        e.preventDefault();
        break;
      case 19:  // MediaPause
      case 413: // MediaStop
        shakaVideoEl.pause();
        showHlsControls();
        e.preventDefault();
        break;
      case 27:  // Escape
      case 8:   // Back
      case 461: // Back (LG/Samsung)
        if (controlsVisible) {
          hideHlsControls();
          e.preventDefault();
        }
        break;
      default:
        // Any other key: show controls if hidden
        if (!controlsVisible) {
          showHlsControls();
          e.preventDefault();
        }
        break;
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
        // Extract title and duration from metadata/customData
        var meta = loadRequestData.media && loadRequestData.media.metadata;
        hlsTitle = (meta && meta.title) || (customData && customData.title) || '';
        hlsTotalDuration = (typeof customData.duration === 'number' && customData.duration > 0) ? customData.duration : 0;
        console.log('[Castalot] HLS total duration from sender: ' + hlsTotalDuration);
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

      var info = getShakaDuration();

      if (statusMessage.status && statusMessage.status.length > 0) {
        var s = statusMessage.status[0];
        if (info) {
          // Override player state with Shaka's actual state
          if (shakaVideoEl.paused) {
            s.playerState = cast.framework.messages.PlayerState.PAUSED;
          } else {
            s.playerState = cast.framework.messages.PlayerState.PLAYING;
          }
          s.currentTime = info.position;
          if (s.media) {
            s.media.duration = info.duration;
          }
        } else {
          // Shaka hasn't loaded yet — report BUFFERING so sender doesn't clear UI
          s.playerState = cast.framework.messages.PlayerState.BUFFERING;
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
        var seekTarget = seekData.currentTime || 0;
        console.log('[Castalot] HLS seek to ' + seekTarget);
        shakaVideoEl.currentTime = seekTarget;
        try { playerManager.broadcastStatus(true); } catch(e) { /* ignore */ }
        showHlsControls();
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
        showHlsControls();
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
        showHlsControls();
        return null;
      }
      return data;
    }
  );

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.STOP,
    (data) => {
      if (hlsModeActive) {
        console.log('[Castalot] HLS stop');
        stopShakaPlayback();
        setPlayerVisible(true);
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
