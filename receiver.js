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
  let rotationCanvasActive = false;
  let rotationAnimFrame = null;

  function applyVideoRotation(degrees) {
    const player = document.getElementById('player');
    if (!player) return;
    const deg = Number(degrees) || 0;
    pendingRotation = deg;
    stopRotationCanvas();
    if (deg === 0) return;

    // Use canvas rendering — CSS transforms don't rotate the hardware video surface
    var root = player.shadowRoot;
    if (!root) {
      console.log('[Castalot] no shadowRoot');
      return;
    }
    var video = root.querySelector('video');
    if (video) {
      startRotationCanvas(video, deg);
    } else {
      var observer = new MutationObserver(function() {
        var v = root.querySelector('video');
        if (v) {
          startRotationCanvas(v, deg);
          observer.disconnect();
        }
      });
      observer.observe(root, { childList: true, subtree: true });
    }
  }

  function startRotationCanvas(video, deg) {
    stopRotationCanvas();
    var canvas = document.createElement('canvas');
    canvas.id = 'rotation-canvas';
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    canvas.width = vw;
    canvas.height = vh;
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;';
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    if (!ctx) {
      console.warn('[Castalot] canvas 2d context unavailable');
      return;
    }
    var rad = deg * Math.PI / 180;
    rotationCanvasActive = true;
    var frameCount = 0;

    function draw() {
      if (!rotationCanvasActive) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, vw, vh);

      if (video.readyState >= 2 && video.videoWidth > 0) {
        var videoW = video.videoWidth;
        var videoH = video.videoHeight;
        var is90or270 = (deg === 90 || deg === 270);
        var rotW = is90or270 ? videoH : videoW;
        var rotH = is90or270 ? videoW : videoH;
        var scale = Math.min(vw / rotW, vh / rotH);
        var drawW = videoW * scale;
        var drawH = videoH * scale;

        ctx.save();
        ctx.translate(vw / 2, vh / 2);
        ctx.rotate(rad);
        try {
          ctx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
        } catch (e) {
          // If drawImage fails, show error text
          ctx.fillStyle = '#f00';
          ctx.font = '40px sans-serif';
          ctx.fillText('drawImage error: ' + e.message, -300, 0);
        }
        ctx.restore();
        if (frameCount === 0) {
          console.log('[Castalot] canvas first frame: video=' + videoW + 'x' + videoH + ' draw=' + Math.round(drawW) + 'x' + Math.round(drawH));
        }
      } else {
        // Video not ready yet — show status
        ctx.fillStyle = '#fff';
        ctx.font = '30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for video (readyState=' + video.readyState + ', size=' + video.videoWidth + 'x' + video.videoHeight + ')', vw / 2, vh / 2);
      }
      frameCount++;
      rotationAnimFrame = requestAnimationFrame(draw);
    }
    rotationAnimFrame = requestAnimationFrame(draw);
    console.log('[Castalot] rotation canvas started: ' + deg + 'deg, viewport=' + vw + 'x' + vh);
  }

  function stopRotationCanvas() {
    rotationCanvasActive = false;
    if (rotationAnimFrame) {
      cancelAnimationFrame(rotationAnimFrame);
      rotationAnimFrame = null;
    }
    var existing = document.getElementById('rotation-canvas');
    if (existing) existing.remove();
    // Restore video visibility
    var player = document.getElementById('player');
    if (player && player.shadowRoot) {
      var video = player.shadowRoot.querySelector('video');
      if (video) video.style.removeProperty('opacity');
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
