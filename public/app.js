// Progressive enhancement. Everything works without this file: /add renders the form,
// POST /add redirects to the new entry. With it: a modal dialog, focus return, a
// "reading the site" state while the AI works, and auto-applied sorting.
(function () {
  var dialog = document.getElementById('add-dialog');
  var opener = null;

  function dialogInput() { return dialog.querySelector('input[name="url"]'); }

  function openDialog(from) {
    opener = from || document.activeElement;
    if (dialog.open) dialog.close(); // upgrade a server-rendered inline dialog to a modal
    dialog.showModal();
    var i = dialogInput();
    i.focus();
    i.select();
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
  dialog.addEventListener('mousedown', function (e) { if (e.target === dialog) dialog.close(); });

  // Classify forms: block empty input, then show the working state (the AI takes a few seconds)
  Array.prototype.forEach.call(document.querySelectorAll('form[data-classify]'), function (form) {
    form.addEventListener('submit', function (e) {
      var input = form.querySelector('input[name="url"]');
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
      var scope = form.closest('.hero-copy') || form;
      var progress = scope.querySelector('.progress');
      var hint = scope.querySelector('.hint-text');
      if (progress) progress.hidden = false;
      if (hint) hint.hidden = true;
    });
  });

  var sort = document.querySelector('[data-autosubmit]');
  if (sort) sort.addEventListener('change', function () { sort.form.submit(); });

  // On narrow screens the category tree starts collapsed unless a filter is active
  var box = document.querySelector('[data-tree-box]');
  if (box && window.matchMedia('(max-width: 1100px)').matches && !box.hasAttribute('data-active')) box.open = false;

  // A server-rendered dialog (errors, /add) becomes the modal; a failed hero submit refocuses its field
  if (dialog.open) openDialog(null);
  var invalid = document.querySelector('.hero-form input[aria-invalid="true"]');
  if (invalid) invalid.focus();
  // keep the added entry in view, then tidy the address bar
  if (document.querySelector('.notice') && location.hash) {
    var target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: 'center' });
    history.replaceState(null, '', '/' + location.hash);
  }
})();
