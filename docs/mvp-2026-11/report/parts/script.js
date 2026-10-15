/* Behaviour for "Claim tagger MVP", copied from the claim tagger analysis report's script (comments tidied, code unchanged).
   - tabs (the side rail) with hash routing: #status, #status-works (a sub-page), #g-... (a glossary entry), #src-... (a source row)
   - sub-page rows built from the "div.sub" children of each tab (data-title names a page, data-layer="tech" marks a Technical page)
   - the Plain / Technical switch, remembered in localStorage (every access sits in try/catch); this page has no switch and no
     Technical page, and the code copes with both being absent
   - "Terms marked *" strips from the Glossary, dfn tooltips, citation tooltips (this page has no glossary and marks no terms)
   - the theme toggle (same data-theme attribute the artifact viewer uses)
   - keyboard: arrow keys, Home and End move between tabs; every control is a real button, link or details element.
   The research page's option-catalog filters are not needed here and were left out. */
(function () {
  'use strict';
  var root = document.documentElement;
  var LAYER_KEY = 'efl-mvp-layer';

  function all(sel, ctx) { return [].slice.call((ctx || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  var panels = all('section[role="tabpanel"]');
  var tabs = all('nav.geo-sidenav [role="tab"]').filter(function (t) {
    var ok = panels.some(function (p) { return p.id === t.getAttribute('aria-controls'); });
    if (!ok) t.hidden = true; // a tab without a panel (single-part previews) stays out of the rail
    return ok;
  });
  tabs.forEach(function (t, i) {
    var n = t.querySelector('.geo-sidenav-num');
    if (n) n.textContent = String(i + 1);
  });

  // ---- Keyboard: arrow keys, Home and End move between the tabs of one tab list and activate the tab they reach.
  //      orientation "both" accepts all four arrows (the rail turns into a row on phones); "horizontal" leaves Up and Down to the page.
  function arrowNav(list, orientation) {
    list.addEventListener('keydown', function (ev) {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
      var k = ev.key, step = 0, jump = null;
      if (k === 'ArrowRight' || (orientation === 'both' && k === 'ArrowDown')) step = 1;
      else if (k === 'ArrowLeft' || (orientation === 'both' && k === 'ArrowUp')) step = -1;
      else if (k === 'Home') jump = 0;
      else if (k === 'End') jump = -1;
      else return;
      var items = all('[role="tab"]', list).filter(function (b) { return !b.hidden; });
      var i = items.indexOf(document.activeElement);
      if (i < 0 || !items.length) return;
      var next = jump === null ? (i + step + items.length) % items.length : (jump < 0 ? items.length - 1 : 0);
      ev.preventDefault();
      items[next].focus();
      items[next].click();
    });
  }
  var rail = document.querySelector('nav.geo-sidenav');
  if (rail) arrowNav(rail, 'both');

  // ---- Sub-pages: a tab's direct children with class "sub" become a row of pages above the first one.
  var subsOf = {}, currentSub = {};
  function showSub(pid, sid) {
    var subs = subsOf[pid];
    if (!subs) return;
    subs.forEach(function (s) { s.hidden = (s.id !== sid); });
    var p = byId(pid);
    all('nav.subnav .geo-tab', p).forEach(function (b) {
      b.setAttribute('aria-selected', b.getAttribute('aria-controls') === sid ? 'true' : 'false');
    });
    currentSub[pid] = sid;
  }
  panels.forEach(function (p) {
    var subs = [].slice.call(p.children).filter(function (c) { return c.classList && c.classList.contains('sub'); });
    if (!subs.length) return;
    subsOf[p.id] = subs;
    if (subs.length > 1) {
      var nav = document.createElement('nav');
      nav.className = 'geo-tabs subnav';
      nav.setAttribute('aria-label', 'Pages in this tab');
      var row = document.createElement('div');
      row.className = 'geo-tabs-row';
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-orientation', 'horizontal');
      subs.forEach(function (s, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'geo-tab';
        b.id = 'subtab-' + s.id;
        b.setAttribute('role', 'tab');
        b.textContent = s.getAttribute('data-title') || ('Page ' + (i + 1));
        b.setAttribute('aria-controls', s.id);
        b.setAttribute('data-layer', s.getAttribute('data-layer') || 'plain');
        s.setAttribute('role', 'tabpanel');
        s.setAttribute('aria-labelledby', b.id);
        b.addEventListener('click', function () {
          showSub(p.id, s.id);
          try { history.replaceState(null, '', '#' + s.id); } catch (e) {}
          window.scrollTo({ top: 0 });
        });
        row.appendChild(b);
      });
      nav.appendChild(row);
      arrowNav(row, 'horizontal');
      p.insertBefore(nav, subs[0]); // after the tab heading and its plain summary, directly above the pages
    }
    showSub(p.id, subs[0].id);
  });

  // ---- Plain / Technical: Plain shows each tab's overview pages; Technical adds the detailed pages and opens every folded section
  var layer = 'plain';
  try {
    var saved = localStorage.getItem(LAYER_KEY);
    if (saved === 'tech' || saved === 'plain') layer = saved;
  } catch (e) {}
  var layerButtons = all('#layer-switch button');
  var HINT = {
    plain: 'Plain: each tab shows its overview pages. Switch to Technical for the detailed pages.',
    tech: 'Technical: every tab shows its detailed pages and every folded section is open.'
  };
  function applyLayer() {
    root.setAttribute('data-layer', layer);
    layerButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-v') === layer ? 'true' : 'false');
    });
    all('details.tech').forEach(function (d) { d.open = (layer === 'tech'); });
    all('nav.subnav .geo-tab').forEach(function (b) {
      b.hidden = (layer === 'plain' && b.getAttribute('data-layer') === 'tech');
    });
    Object.keys(subsOf).forEach(function (pid) {
      var cur = byId(currentSub[pid]);
      if (layer === 'plain' && cur && cur.getAttribute('data-layer') === 'tech') {
        var first = subsOf[pid].filter(function (s) { return s.getAttribute('data-layer') !== 'tech'; })[0];
        if (first) showSub(pid, first.id);
      }
    });
    var hint = byId('layer-hint');
    if (hint) hint.textContent = HINT[layer];
    try { localStorage.setItem(LAYER_KEY, layer); } catch (e) {}
  }
  layerButtons.forEach(function (b) {
    b.addEventListener('click', function () { layer = b.getAttribute('data-v'); applyLayer(); });
  });

  // ---- Tabs and deep links: #tab, #sub-page, #g-... (glossary entry), #src-... (source row), or any other id
  function show(id) {
    tabs.forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('aria-controls') === id ? 'true' : 'false'); });
    panels.forEach(function (p) { p.hidden = (p.id !== id); });
  }
  function reveal(el) {
    // make the sub-page that holds el visible; switch to Technical if that page needs it
    var sub = el.closest && el.closest('.sub');
    if (!sub) return;
    var panel = sub.closest('section[role="tabpanel"]');
    if (!panel) return;
    if (sub.getAttribute('data-layer') === 'tech' && layer !== 'tech') { layer = 'tech'; applyLayer(); }
    showSub(panel.id, sub.id);
  }
  function highlight(el) {
    all('.geo-row-highlight').forEach(function (r) { r.classList.remove('geo-row-highlight'); });
    el.classList.add('geo-row-highlight');
    var d = el.closest && el.closest('details');
    if (d) d.open = true;
    setTimeout(function () { el.scrollIntoView({ block: 'center' }); }, 0);
  }
  function goHash(x) {
    if (!x) return false;
    if (panels.some(function (p) { return p.id === x; })) { show(x); window.scrollTo({ top: 0 }); return true; }
    var el = byId(x);
    if (!el) return false;
    var panel = el.closest('section[role="tabpanel"]');
    if (!panel) return false;
    show(panel.id);
    if (el.classList.contains('sub')) {
      if (el.getAttribute('data-layer') === 'tech' && layer !== 'tech') { layer = 'tech'; applyLayer(); }
      showSub(panel.id, el.id);
      window.scrollTo({ top: 0 });
      return true;
    }
    reveal(el);
    if (/^src-/.test(x)) el = el.closest('tr') || el;
    if (/^(src|g)-/.test(x)) highlight(el);
    else setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 0);
    return true;
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var id = t.getAttribute('aria-controls');
      show(id);
      window.scrollTo({ top: 0 });
      try { history.replaceState(null, '', '#' + id); } catch (e) {}
    });
  });
  applyLayer();
  var hash = (location.hash || '').replace('#', '');
  if (!goHash(hash) && panels.length) show(panels[0].id);
  window.addEventListener('hashchange', function () { goHash((location.hash || '').replace('#', '')); });
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="#"]');
    if (!a) return;
    var x = a.getAttribute('href').slice(1);
    if (goHash(x)) {
      ev.preventDefault();
      try { history.replaceState(null, '', '#' + x); } catch (e) {}
    }
  });

  // ---- Terms marked *: the Glossary tab feeds each tab's strip and the dfn tooltips
  var gloss = {};
  all('section#glossary dt[id^="g-"]').forEach(function (dt) {
    var dd = dt.nextElementSibling;
    gloss[dt.id.replace(/^g-/, '')] = { term: dt.textContent, def: dd ? dd.textContent : '' };
  });
  panels.forEach(function (p) {
    var strip = p.querySelector('aside.terms[data-strip]');
    if (!strip) return;
    var seen = {}, order = [];
    all('dfn[data-t]', p).forEach(function (d) {
      var k = d.getAttribute('data-t'), g = gloss[k];
      if (g) d.setAttribute('title', g.def);
      if (g && !seen[k]) { seen[k] = 1; order.push(k); }
    });
    if (!order.length) { strip.remove(); return; }
    var h4 = document.createElement('h4');
    h4.className = 'geo-glossary-title';
    h4.textContent = 'Terms marked * on this tab';
    strip.appendChild(h4);
    var dl = document.createElement('dl');
    dl.className = 'geo-glossary';
    order.sort(function (a, b) { return gloss[a].term.localeCompare(gloss[b].term, 'en', { sensitivity: 'base' }); });
    order.forEach(function (k) {
      var dt = document.createElement('dt');
      dt.textContent = gloss[k].term;
      var dd = document.createElement('dd');
      dd.textContent = gloss[k].def;
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
    strip.appendChild(dl);
  });

  // ---- Citation markers: title tooltips from the source rows they point to
  all('a.cite').forEach(function (a) {
    var row = byId(a.getAttribute('href').slice(1));
    if (row) {
      row = row.closest('tr') || row;
      var c = row.querySelector('.src-title');
      if (c) a.setAttribute('title', c.textContent);
    }
  });

  // ---- Theme switch (same attribute the artifact viewer uses)
  var sw = byId('theme-toggle');
  if (sw) {
    var isDark = function () {
      return root.getAttribute('data-theme') === 'dark' ||
        (!root.getAttribute('data-theme') && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    };
    var sun = byId('theme-icon-sun'), moon = byId('theme-icon-moon');
    var sync = function () {
      var d = isDark();
      sw.setAttribute('aria-checked', d ? 'true' : 'false');
      if (sun) sun.hidden = d;
      if (moon) moon.hidden = !d;
    };
    sw.addEventListener('click', function () { root.setAttribute('data-theme', isDark() ? 'light' : 'dark'); sync(); });
    if (window.MutationObserver) new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
  }
})();
