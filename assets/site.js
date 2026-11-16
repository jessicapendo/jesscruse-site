// Pop-ups for the "Help me" and "Help my team" tiles.
(function () {
  var lastFocus = null;

  function open(name) {
    var modal = document.getElementById('modal-' + name);
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    var first = modal.querySelector('a[href]');
    if (first) first.focus();
  }

  function closeAll() {
    document.querySelectorAll('.modal').forEach(function (m) { m.hidden = true; });
    if (lastFocus) lastFocus.focus();
  }

  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-open]');
    if (opener) { open(opener.getAttribute('data-open')); return; }
    if (event.target.closest('[data-close]')) closeAll();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAll();
  });
})();
