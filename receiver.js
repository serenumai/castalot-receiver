/* global cast */
(() => {
  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  const watermarkEl = document.getElementById('watermark');
  const watermarkTextEl = watermarkEl ? watermarkEl.querySelector('span') : null;

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
      return loadRequestData;
    }
  );

  playerManager.addEventListener(
    cast.framework.events.EventType.PLAYER_LOAD_COMPLETE,
    () => {
      const data = playerManager.getMediaInformation();
      // Preserve current state if no customData
      if (data && data.customData) {
        applyWatermarkFromCustomData(data.customData);
      }
    }
  );

  context.start({
    disableIdleTimeout: true
  });
})();
