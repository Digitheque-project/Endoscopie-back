/* Affiche GET / POST / PATCH en anglais (au lieu de Obtenir / Envoyer en français) */
(function () {
  const METHOD_BY_CLASS = {
    'opblock-get': 'GET',
    'opblock-post': 'POST',
    'opblock-patch': 'PATCH',
    'opblock-put': 'PUT',
    'opblock-delete': 'DELETE',
  };

  function fixMethodLabels() {
    document.querySelectorAll('.opblock').forEach((block) => {
      const label = block.querySelector('.opblock-summary-method');
      if (!label) return;
      for (const [className, method] of Object.entries(METHOD_BY_CLASS)) {
        if (block.classList.contains(className)) {
          label.textContent = method;
          break;
        }
      }
    });
  }

  const observer = new MutationObserver(fixMethodLabels);
  window.addEventListener('load', () => {
    fixMethodLabels();
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
