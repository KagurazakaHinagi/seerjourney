/* Route backdrop taps through each dialog's existing cancel/draft workflow. */
(function () {
  'use strict';
  const attached = new WeakSet();
  function attach(dialog) {
    if (attached.has(dialog)) return;
    attached.add(dialog);
    let pointer = null, completedOutside = false;
    function outside(event) {
      if (event.target !== dialog || !dialog.open) return false;
      const bounds = dialog.getBoundingClientRect();
      return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }
    function reset() { pointer = null; completedOutside = false; }
    dialog.addEventListener('pointerdown', event => {
      reset();
      if (event.button === 0 && event.isPrimary !== false && outside(event)) pointer = event.pointerId;
    });
    dialog.addEventListener('pointerup', event => {
      completedOutside = pointer !== null && event.pointerId === pointer && outside(event);
      pointer = null;
    });
    dialog.addEventListener('pointercancel', reset);
    dialog.addEventListener('close', reset);
    dialog.addEventListener('click', event => {
      // WebKit's compatibility click can have a different ID from its touch.
      // Match down/up instead, and ignore gestures beginning inside the dialog.
      const dismiss = completedOutside && outside(event);
      reset();
      if (!dismiss) return;
      const cancel = new Event('cancel', { cancelable: true });
      if (dialog.dispatchEvent(cancel) && dialog.open) dialog.close();
    });
  }
  window.MapJourneyDialogDismiss = { attach };
  document.querySelectorAll('dialog').forEach(attach);
})();
