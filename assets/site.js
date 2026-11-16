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
    if (event.key === 'Escape') { closeAll(); return; }
    if (event.key !== 'Tab') return;
    var openModal = document.querySelector('.modal:not([hidden])');
    if (!openModal) return;
    var items = openModal.querySelectorAll('a[href], button:not([style*="opacity: 0"])');
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (!openModal.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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

    if (!formats.length) {
      error.textContent = 'Please pick at least one format: physical copy, audiobook or PDF.';
      error.hidden = false;
      return;
    }

    var endpoint = document.body.getAttribute('data-endpoint');
    var key = form.getAttribute('data-key');
    var formatText = formats.map(function (f) { return formatLabels[f]; }).join(', ');
    var submitBtn = form.querySelector('button[type="submit"]');

    function post(url, payload, headers, okField) {
      return fetch(url, { method: 'POST', headers: headers || undefined, body: JSON.stringify(payload) }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok || body[okField] === false) throw new Error(body.message || ('status ' + response.status));
        });
      });
    }

    function viaSheet() {
      return post(endpoint, {
        kind: 'preorder', name: data.get('firstname'), email: data.get('email'), city: data.get('city'),
        country: data.get('country'), format: formatText, copies: data.get('copies'), website: data.get('website') || ''
      }, null, 'ok');
    }

    function viaEmail() {
      return post('https://api.web3forms.com/submit', {
        access_key: key, subject: 'New pre-order: A Book About Voice', from_name: 'jesscruse.com',
        Name: data.get('firstname'), email: data.get('email'), City: data.get('city'), Country: data.get('country'),
        Format: formatText, Copies: data.get('copies')
      }, { 'Content-Type': 'application/json', 'Accept': 'application/json' }, 'success');
    }

    if (endpoint || key) {
      if (data.get('website')) { done(); return; }
      submitBtn.disabled = true;
      // Try the main route first. If it fails, quietly try the backup so an order is never lost.
      var attempt = endpoint ? viaSheet().catch(function (err) { if (key) return viaEmail(); throw err; }) : viaEmail();
      attempt.then(function () {
        if (window.jessTrack) window.jessTrack('Click', 'Pre-order sent');
        done();
      }).catch(function (err) {
        submitBtn.disabled = false;
        error.innerHTML = '';
        error.appendChild(document.createTextNode('Sorry, that did not send. Please try again, or email '));
        var mail = document.createElement('a');
        mail.href = 'mailto:' + owner + '?subject=' + encodeURIComponent('Pre-order: A Book About Voice');
        mail.textContent = owner;
        mail.style.color = 'inherit';
        error.appendChild(mail);
        error.appendChild(document.createTextNode('. (' + (err && err.message ? err.message : 'no connection') + ')'));
        error.hidden = false;
      });
      return;
    }

    if (!portal || !formId) {
      var lines = [
        'Name: ' + data.get('firstname'),
        'Email: ' + data.get('email'),
        'City: ' + (data.get('city') || ''),
        'Country: ' + data.get('country'),
        'Format: ' + formats.map(function (f) { return formatLabels[f]; }).join(', '),
        'Copies: ' + data.get('copies')
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
      { name: 'book_format_preference', value: formats.join(';') },
      { name: 'book_copies_wanted', value: data.get('copies') }
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

/* Open links to other websites in a new tab */
(function () {
  var links = document.querySelectorAll('a[href^="http"]');
  for (var i = 0; i < links.length; i++) {
    if (links[i].hostname && links[i].hostname !== window.location.hostname) {
      links[i].target = '_blank';
      links[i].rel = 'noopener';
    }
  }
})();

/* Count visits and clicks. No cookies, nothing stored on the visitor's device, no personal details. */
(function () {
  var endpoint = document.body.getAttribute('data-endpoint');
  if (!endpoint) return;
  var page = window.location.pathname.replace(/\/index\.html$/, '/') || '/';

  function send(type, label, source) {
    var payload = JSON.stringify({ kind: 'event', type: type, label: label || '', page: page, source: source || '' });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, payload)) return;
    } catch (e) {}
    try { fetch(endpoint, { method: 'POST', body: payload, keepalive: true, mode: 'no-cors' }); } catch (e) {}
  }
  window.jessTrack = send;

  var from = '';
  try { from = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; } catch (e) {}
  var own = window.location.hostname.replace(/^www\./, '');
  if (from && from === own) send('Page view', '');
  else send('Visit', '', from);

  var openers = { me: 'Help me with my voice', team: 'Help my team', speak: 'Speak here' };

  document.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-open]');
    if (opener) { send('Click', openers[opener.getAttribute('data-open')] || 'Pop-up'); return; }
    var link = event.target.closest('a[href]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('mailto:') === 0) { send('Click', 'Email Jess'); return; }
    if (href === '#blog') { send('Click', 'Keep reading'); return; }
    if (href === '#book') { send('Click', 'Dive deeper'); return; }
    if (/(^|\/)book\/(#preorder)?$/.test(href)) { send('Click', 'Book page'); return; }
    if (href.indexOf('http') !== 0 || link.hostname === window.location.hostname) return;
    var host = link.hostname.replace(/^www\./, '');
    var names = [
      ['calendly.com', 'Book a call'], ['voxa.club', 'Voxa app'], ['linktr.ee', 'Linktree'],
      ['instagram.com', 'Instagram'], ['linkedin.com', 'LinkedIn'], ['substack.com', 'Substack'],
      ['youtube', 'YouTube'], ['youtu.be', 'YouTube'], ['spotify.com', 'Spotify']
    ];
    var label = host;
    for (var i = 0; i < names.length; i++) if (host.indexOf(names[i][0]) !== -1) { label = names[i][1]; break; }
    send('Click', label);
  }, true);
})();

/* Country suggestions on the pre-order form: appear after three letters. */
(function () {
  var input = document.getElementById('country-input');
  var list = document.getElementById('country-list');
  if (!input || !list) return;
  var countries = ['Algeria', 'Argentina', 'Australia', 'Austria', 'Bahrain', 'Bangladesh', 'Belgium', 'Botswana', 'Brazil', 'Cameroon', 'Canada', 'Chile', 'China', 'Colombia', 'Cyprus', 'Czechia', 'Denmark', 'Egypt', 'Ethiopia', 'Finland', 'France', 'Germany', 'Ghana', 'Greece', 'Hong Kong', 'Hungary', 'India', 'Indonesia', 'Iraq', 'Ireland', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kenya', 'Kuwait', 'Lebanon', 'Libya', 'Malaysia', 'Mauritius', 'Mexico', 'Morocco', 'Mozambique', 'Namibia', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway', 'Oman', 'Pakistan', 'Palestine', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Rwanda', 'Saudi Arabia', 'Senegal', 'Singapore', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Tanzania', 'Thailand', 'Tunisia', 'Turkey', 'Uganda', 'United Arab Emirates', 'United Kingdom', 'United States', 'Vietnam', 'Zambia', 'Zimbabwe'];
  var alias = { 'uae': 'United Arab Emirates', 'usa': 'United States', 'america': 'United States', 'england': 'United Kingdom', 'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'britain': 'United Kingdom', 'great britain': 'United Kingdom', 'ksa': 'Saudi Arabia', 'holland': 'Netherlands', 'emirates': 'United Arab Emirates', 'dubai': 'United Arab Emirates' };
  var active = -1;

  function close() { list.hidden = true; list.innerHTML = ''; active = -1; input.setAttribute('aria-expanded', 'false'); }

  function pick(name) { input.value = name; close(); }

  function show() {
    var q = input.value.trim().toLowerCase();
    if (q.length < 3) { close(); return; }
    var starts = [], contains = [];
    countries.forEach(function (c) {
      var i = c.toLowerCase().indexOf(q);
      if (i === 0) starts.push(c); else if (i > 0) contains.push(c);
    });
    Object.keys(alias).forEach(function (a) {
      if (a.indexOf(q) === 0 && starts.indexOf(alias[a]) === -1 && contains.indexOf(alias[a]) === -1) starts.push(alias[a]);
    });
    var matches = starts.concat(contains).slice(0, 8);
    if (!matches.length || (matches.length === 1 && matches[0].toLowerCase() === q)) { close(); return; }
    list.innerHTML = '';
    matches.forEach(function (name, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'country-option-' + i;
      li.textContent = name;
      li.addEventListener('mousedown', function (e) { e.preventDefault(); pick(name); });
      list.appendChild(li);
    });
    active = -1;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function mark(i) {
    var items = list.children;
    if (!items.length) return;
    active = (i + items.length) % items.length;
    for (var n = 0; n < items.length; n++) items[n].setAttribute('aria-selected', n === active ? 'true' : 'false');
    input.setAttribute('aria-activedescendant', items[active].id);
    items[active].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', show);
  input.addEventListener('blur', function () { setTimeout(close, 120); });
  input.addEventListener('keydown', function (e) {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); mark(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(active - 1); }
    else if (e.key === 'Enter' && active > -1) { e.preventDefault(); pick(list.children[active].textContent); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
})();

/* Videos load only when someone presses play, so the page itself stays fast. */
(function () {
  var players = document.querySelectorAll('.yt[data-yt]');
  for (var i = 0; i < players.length; i++) {
    players[i].addEventListener('click', function () {
      var frame = document.createElement('iframe');
      frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(this.getAttribute('data-yt')) + '?autoplay=1';
      frame.title = this.getAttribute('data-title') || 'Video';
      frame.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0';
      this.parentNode.replaceChild(frame, this);
      if (window.jessTrack) window.jessTrack('Click', 'Played a video');
    });
  }
})();
