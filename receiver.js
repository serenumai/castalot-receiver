/* global cast */
(() => {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const watermarkEl = document.getElementById('watermark');
  const watermarkTextEl = watermarkEl ? watermarkEl.querySelector('span') : null;
  const splashEl = document.getElementById('splash');
  let splashShownThisSession = false;

  function showSplash() {
    if (!splashEl) return;
    splashEl.classList.remove('hidden');
    splashEl.classList.add('visible');
  }

  function hideSplash() {
    if (!splashEl) return;
    splashEl.classList.remove('visible');
    window.setTimeout(() => splashEl.classList.add('hidden'), 220);
  }

  function setWatermarkVisible(visible) {
    if (!watermarkEl) return;
    watermarkEl.classList.toggle('hidden', !visible);
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
    setWatermarkVisible(enabled);
  }

  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD,
    (loadRequestData) => {
      applyWatermarkFromCustomData(loadRequestData && loadRequestData.customData);
      if (!splashShownThisSession) {
        showSplash();
        if (loadRequestData) {
          loadRequestData.autoplay = false;
        }
      }
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
      if (!splashShownThisSession) {
        splashShownThisSession = true;
        window.setTimeout(() => {
          hideSplash();
          playerManager.play();
        }, 1000);
      }
    }
  );

  context.start({
    disableIdleTimeout: true
  });
})();
