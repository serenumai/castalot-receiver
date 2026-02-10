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
  const hlsNamespace = 'urn:x-cast:ai.serenum.castalot.hls';
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
  let hlsSeekPending = false;
  const hlsControlsEl = document.getElementById('hlsControls');
  const hlsTitleEl = document.getElementById('hlsTitle');
  const hlsPlayPauseEl = document.getElementById('hlsPlayPause');
  const hlsCurrentTimeEl = document.getElementById('hlsCurrentTime');
  const hlsDurationEl = document.getElementById('hlsDuration');
  const hlsProgressFillEl = document.getElementById('hlsProgressFill');
  const hlsProgressSeekableEl = document.getElementById('hlsProgressSeekable');
  const hlsBufferingEl = document.getElementById('hlsBuffering');
  const modeBadgeEl = document.getElementById('modeBadge');
  let modeBadgeTimer = null;

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
    showHlsBuffering();

    document.addEventListener('keydown', onHlsKeyDown);

    shakaPlayer.load(hlsUrl).then(function() {
      console.log('[Castalot] Shaka HLS loaded:', hlsUrl);
      shakaVideoEl.play();
      hideSplash();
      hideHlsBuffering();
      // Broadcast status periodically so sender sees correct position/duration
      startHlsStatusBroadcast();
      // Show controls briefly so user knows they exist
      showHlsControls();
    }).catch(function(error) {
      console.error('[Castalot] Shaka load failed:', error);
      hlsModeActive = false;
      setShakaVideoVisible(false);
      hideHlsBuffering();
    });
  }

  function stopShakaPlayback() {
    hlsModeActive = false;
    stopHlsStatusBroadcast();
    document.removeEventListener('keydown', onHlsKeyDown);
    hideHlsControls();
    hideHlsBuffering();
    hideModeBadge();
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
        // Auto-hide buffering when Shaka is actually playing
        if (shakaVideoEl && !shakaVideoEl.paused && shakaVideoEl.currentTime > 0) {
          hideHlsBuffering();
        }
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
    // Fallback: try video.duration if it's finite and reasonable (< 24 hours).
    // HLS EVENT playlists can produce huge garbage values from the media source timeline.
    var d = shakaVideoEl ? shakaVideoEl.duration : NaN;
    if (isFinite(d) && d > 0 && d < 86400) {
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
    // Show seekable range (transcoded portion) as a lighter bar behind the playback position
    if (hlsProgressSeekableEl && dur > 0) {
      var seekableEnd = getSeekableEnd();
      if (seekableEnd !== null && seekableEnd < dur * 0.99) {
        // Still transcoding — show how much is available
        hlsProgressSeekableEl.style.width = ((seekableEnd / dur) * 100).toFixed(1) + '%';
      } else {
        // Fully transcoded or no range info — fill to 100%
        hlsProgressSeekableEl.style.width = '100%';
      }
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
        handleSeekTarget(shakaVideoEl.currentTime + 10);
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

  // MARK: - Buffering Indicator

  let hlsBufferingTimeout = null;

  function showHlsBuffering() {
    if (!hlsBufferingEl) return;
    hlsBufferingEl.classList.remove('hidden');
    // Safety timeout: auto-hide after 15s to prevent stuck indicator
    clearHlsBufferingTimeout();
    hlsBufferingTimeout = setTimeout(function() {
      console.log('[Castalot] Buffering indicator auto-hidden (timeout)');
      hideHlsBuffering();
    }, 15000);
  }

  function hideHlsBuffering() {
    if (!hlsBufferingEl) return;
    hlsBufferingEl.classList.add('hidden');
    clearHlsBufferingTimeout();
  }

  function clearHlsBufferingTimeout() {
    if (hlsBufferingTimeout) {
      clearTimeout(hlsBufferingTimeout);
      hlsBufferingTimeout = null;
    }
  }

  // MARK: - Mode Badge

  function showModeBadge(text) {
    if (!modeBadgeEl || !text) return;
    modeBadgeEl.textContent = text;
    modeBadgeEl.classList.remove('hidden');
    if (modeBadgeTimer) clearTimeout(modeBadgeTimer);
    modeBadgeTimer = setTimeout(function() {
      modeBadgeEl.classList.add('hidden');
      modeBadgeTimer = null;
    }, 6000);
  }

  function hideModeBadge() {
    if (!modeBadgeEl) return;
    modeBadgeEl.classList.add('hidden');
    if (modeBadgeTimer) {
      clearTimeout(modeBadgeTimer);
      modeBadgeTimer = null;
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

  // Register HLS namespace so receiver can send seek requests to sender
  context.addCustomMessageListener(hlsNamespace, (event) => {
    // Sender-to-receiver messages on this namespace are not currently used,
    // but the namespace must be registered to enable sendCustomMessage.
    console.log('[Castalot] HLS channel message:', event && event.data);
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

      // Show mode badge
      var modeLabel = customData && customData.castingMode;
      if (modeLabel) {
        showModeBadge(modeLabel);
      }

      // HLS mode: use Shaka Player for playback, CAF for media session
      if (customData && customData.hlsMode === true && customData.hlsUrl) {
        console.log('[Castalot] HLS mode — Shaka + CAF bridge: ' + customData.hlsUrl);
        hlsSeekPending = false; // New LOAD arrived — sender restarted successfully
        hideSplash();
        startShakaPlayback(customData.hlsUrl);
        // Set title and duration AFTER startShakaPlayback — it calls stopShakaPlayback()
        // internally which clears these values, so they must be set after that cleanup.
        var meta = loadRequestData.media && loadRequestData.media.metadata;
        hlsTitle = (meta && meta.title) || (customData && customData.title) || '';
        hlsTotalDuration = (typeof customData.duration === 'number' && customData.duration > 0) ? customData.duration : 0;
        console.log('[Castalot] HLS total duration from sender: ' + hlsTotalDuration);

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

  // MARK: - Seek clamping for live-transcoding HLS

  function getSeekableEnd() {
    // During live transcoding, shakaPlayer.seekRange() reflects only what's been transcoded.
    // We must clamp seeks to this range to avoid the tug-of-war effect where the player
    // snaps back to the buffer edge after an out-of-range seek.
    // IMPORTANT: Do NOT fall back to video.duration — MSE can report the full duration
    // even when only a few segments are available, which defeats seek-ahead detection.
    if (shakaPlayer) {
      try {
        var range = shakaPlayer.seekRange();
        if (range && isFinite(range.end) && range.end > 0) {
          return range.end;
        }
      } catch(e) { /* ignore */ }
    }
    return null;
  }

  function requestSenderSeek(position) {
    // Debounce: only send one seek request at a time. The sender will restart
    // transcoding and send a new LOAD, which clears hlsSeekPending.
    if (hlsSeekPending) {
      console.log('[Castalot] Seek already pending — ignoring position ' + position.toFixed(1) + 's');
      return;
    }
    var senders = context.getSenders();
    if (!senders || senders.length === 0) {
      console.warn('[Castalot] No senders to send seek request to');
      return;
    }
    hlsSeekPending = true;
    var payload = { type: 'seekRequest', position: position };
    console.log('[Castalot] Requesting sender to transcode from ' + position.toFixed(1) + 's');
    showHlsBuffering();
    senders.forEach(function(sender) {
      try {
        context.sendCustomMessage(hlsNamespace, sender.senderId, payload);
      } catch(err) {
        console.warn('[Castalot] Failed to send seek request:', err);
      }
    });
  }

  function handleSeekTarget(target) {
    // If the target is within the seekable range, seek directly.
    // If it's beyond the transcoded range, ask the sender to restart from that point.
    var seekableEnd = getSeekableEnd();
    if (seekableEnd !== null && target > seekableEnd + 1) {
      // Beyond available range — request sender to restart transcode from this position
      console.log('[Castalot] Seek target ' + target.toFixed(1) + 's beyond seekable end ' + seekableEnd.toFixed(1) + 's — requesting sender restart');
      requestSenderSeek(target);
      return;
    }
    // Within range — seek directly, clamping to available buffer
    var clamped = target;
    if (seekableEnd !== null && target > seekableEnd) {
      clamped = Math.max(0, seekableEnd - 0.5);
    }
    clamped = Math.max(0, clamped);
    shakaVideoEl.currentTime = clamped;
  }

  // MARK: - Control bridges: forward SEEK/PAUSE/PLAY to Shaka

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.SEEK,
    (seekData) => {
      if (hlsModeActive && shakaVideoEl) {
        var seekTarget = seekData.currentTime || 0;
        console.log('[Castalot] HLS seek to ' + seekTarget.toFixed(1));
        handleSeekTarget(seekTarget);
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
