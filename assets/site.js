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

// Book pre-order form. Sends to HubSpot when it is connected; otherwise opens an email with the answers.
(function () {
  var form = document.getElementById('preorder-form');
  if (!form) return;
  var thanks = document.getElementById('preorder-thanks');
  var error = document.getElementById('preorder-error');
  var formatLabels = { physical_copy: 'Physical copy', audiobook: 'Audiobook', pdf: 'PDF' };

  function done() {
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus();
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    error.hidden = true;
    var data = new FormData(form);
    var formats = data.getAll('format');
    var portal = form.getAttribute('data-portal');
    var formId = form.getAttribute('data-form');
    var owner = form.getAttribute('data-email');

    if (!portal || !formId) {
      var lines = [
        'Name: ' + data.get('firstname'),
        'Email: ' + data.get('email'),
        'City: ' + (data.get('city') || ''),
        'Country: ' + data.get('country'),
        'Format: ' + formats.map(function (f) { return formatLabels[f]; }).join(', ')
      ];
      window.location.href = 'mailto:' + owner + '?subject=' + encodeURIComponent('Pre-order: A Book About Voice') + '&body=' + encodeURIComponent(lines.join('\n'));
      return;
    }

    var button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    var fields = [
      { name: 'firstname', value: data.get('firstname') },
      { name: 'email', value: data.get('email') },
      { name: 'city', value: data.get('city') || '' },
      { name: 'country', value: data.get('country') },
      { name: 'book_format_preference', value: formats.join(';') }
    ];
    fetch('https://api.hsforms.com/submissions/v3/integration/submit/' + portal + '/' + formId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields, context: { pageUri: window.location.href, pageName: document.title } })
    }).then(function (response) {
      if (!response.ok) throw new Error('status ' + response.status);
      done();
    }).catch(function () {
      button.disabled = false;
      error.textContent = 'Sorry, that did not send. Please try again, or email ' + owner + '.';
      error.hidden = false;
    });
  });
})();
