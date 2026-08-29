// Pull request list JavaScript
// Filters the list the server already rendered. No request, no reload: the whole list is
// in the document, so matching it is a DOM walk.

(function () {
  'use strict';

  // How long to wait after the last keystroke before filtering.
  var DEBOUNCE_MS = 100;

  /**
   * Split a query into terms. Whitespace separates them and case is ignored.
   * An empty query has no terms, which every entry satisfies.
   */
  function parseQuery(raw) {
    return String(raw == null ? '' : raw)
      .toLowerCase()
      .split(/\s+/)
      .filter(function (term) { return term.length > 0; });
  }

  /**
   * An entry matches when EVERY term matches it — the query is an AND.
   *
   * A single term matches if it appears in the pull request number or in the title. A
   * leading `#` is dropped before the number is checked, so both `42` and `#42` find
   * pull request 42. Matching is by substring, so a partly typed word still narrows the
   * list while it is being typed, which is the point of filtering as you type.
   */
  function entryMatches(entry, terms) {
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      var bare = term.charAt(0) === '#' ? term.slice(1) : term;
      var inNumber = bare.length > 0 && entry.number.indexOf(bare) !== -1;
      var inTitle = entry.title.indexOf(term) !== -1;
      if (!inNumber && !inTitle) return false;
    }
    return true;
  }

  function init() {
    var page = document.querySelector('.pulls-page');
    var box = document.getElementById('pulls-search');
    var input = document.getElementById('pulls-search-input');
    var count = document.getElementById('pulls-search-count');
    var noMatches = document.getElementById('pulls-no-matches');
    if (!page || !box || !input) return;

    // The control is markup-hidden until here, so a reader without JavaScript is not
    // offered a box that would do nothing.
    box.hidden = false;

    var entries = [].slice.call(page.querySelectorAll('.js-pull-entry')).map(function (el) {
      return {
        el: el,
        number: String(el.getAttribute('data-number') || ''),
        title: String(el.getAttribute('data-title') || '').toLowerCase(),
      };
    });
    var stacks = [].slice.call(page.querySelectorAll('.stack'));
    var headings = [].slice.call(page.querySelectorAll('[data-section-heading]'));
    var total = entries.length;

    function apply() {
      var terms = parseQuery(input.value);
      var searching = terms.length > 0;
      var shown = 0;

      for (var i = 0; i < entries.length; i++) {
        var hit = !searching || entryMatches(entries[i], terms);
        entries[i].el.hidden = !hit;
        if (hit) shown++;
      }

      // A stack whose every entry is filtered out has nothing left to head.
      for (var s = 0; s < stacks.length; s++) {
        stacks[s].hidden = !stacks[s].querySelector('.js-pull-entry:not([hidden])');
      }

      // Likewise a section heading over an empty section.
      for (var h = 0; h < headings.length; h++) {
        var selector = headings[h].getAttribute('data-section-heading');
        headings[h].hidden = !page.querySelector(selector + ' .js-pull-entry:not([hidden])');
      }

      // The rail draws how the pull requests in a stack sit on top of each other. Once
      // some of them are filtered out it would be drawing a shape that is no longer
      // there, so it is hidden while a query is active. Nothing is lost: draft and
      // approval state are also written in the row itself.
      page.classList.toggle('is-searching', searching);

      if (noMatches) noMatches.hidden = !(searching && shown === 0);
      if (count) {
        count.textContent = searching ? shown + ' of ' + total : '';
      }
    }

    var timer = null;
    input.addEventListener('input', function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        apply();
      }, DEBOUNCE_MS);
    });

    // Escape clears the box. Applied at once — the delay exists to wait out typing, and
    // this is not typing.
    input.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || input.value === '') return;
      if (timer) { clearTimeout(timer); timer = null; }
      input.value = '';
      apply();
    });

    // The browser can restore a typed value on a back navigation, so filter once now
    // rather than showing the whole list under a query that is already in the box.
    apply();
  }

  init();
})();
