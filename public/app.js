// Progressive enhancement: everything works without this file (/add renders the form,
// POST /add redirects). With it: modal dialog, focus return, submitting state, auto-sort.
(function () {
  var dialog = document.getElementById('add-dialog');
  var input = document.getElementById('url');
  var opener = null;

  function openDialog(from) {
    opener = from || document.activeElement;
    if (dialog.open) dialog.close(); // upgrade a server-rendered inline form to a modal
    dialog.showModal();
    input.focus();
    input.select();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-open-add]'), function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); openDialog(el); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (el) {
    el.addEventListener('click', function (e) { e.preventDefault(); dialog.close(); });
  });
  dialog.addEventListener('close', function () {
    if (opener && opener.focus) opener.focus();
    if (location.pathname === '/add') history.replaceState(null, '', '/');
  });
  // Click on the backdrop closes
  dialog.addEventListener('mousedown', function (e) { if (e.target === dialog) dialog.close(); });

  // Submitting state
  var form = dialog.querySelector('form');
  form.addEventListener('submit', function (e) {
    if (!input.value.trim()) {
      e.preventDefault();
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    var btn = form.querySelector('[data-submit]');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    btn.querySelector('.label').hidden = true;
    btn.querySelector('.busy').hidden = false;
  });

  // Sort menu applies on change
  var sort = document.querySelector('[data-autosubmit]');
  if (sort) sort.addEventListener('change', function () { sort.form.submit(); });

  // A server-rendered form (error or /add) becomes the modal
  if (dialog.open) openDialog(null);
  var added = document.querySelector('.notice');
  if (added) history.replaceState(null, '', '/');
})();
