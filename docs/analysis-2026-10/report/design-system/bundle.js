/* @ds-bundle: {"format":4,"namespace":"Geo","components":[{"name":"Button"},{"name":"Tag"},{"name":"Badge"},{"name":"Chip"},{"name":"StatusChip"},{"name":"PillToggle"},{"name":"Tabs"},{"name":"SideNav"},{"name":"PageHeader"},{"name":"Card"},{"name":"StatCard"},{"name":"Callout"},{"name":"Table"},{"name":"Code"},{"name":"Figure"},{"name":"Disclosure"},{"name":"Term"},{"name":"Glossary"},{"name":"Divider"},{"name":"Input"},{"name":"Checkbox"},{"name":"Toggle"},{"name":"Icon"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  var ICONS = {
  "check": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M2 8L6 12L14 4\" stroke=\"currentColor\"/> </svg>",
  "minus": "<svg width=\"16\" height=\"17\" viewBox=\"0 0 16 17\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M2 8.5H14\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "search": "<svg width=\"16\" height=\"17\" viewBox=\"0 0 16 17\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <rect x=\"0.5\" y=\"1\" width=\"12\" height=\"12\" rx=\"6\" stroke=\"currentColor\"/> <path d=\"M15.33 15.83L11 11.5\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "close": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\"> <path d=\"M2 14L14 2\" stroke=\"currentColor\"/> <path d=\"M2 2L14 14\" stroke=\"currentColor\"/> </svg>",
  "chevron-down-small": "<svg width=\"8\" height=\"8\" viewBox=\"0 0 8 8\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M0.853553 2.14645C0.658291 1.95118 0.341709 1.95118 0.146447 2.14645C-0.0488155 2.34171 -0.0488155 2.65829 0.146447 2.85355L0.853553 2.14645ZM4 6L3.64645 6.35355L4 6.70711L4.35355 6.35355L4 6ZM7.85355 2.85355C8.04882 2.65829 8.04882 2.34171 7.85355 2.14645C7.65829 1.95118 7.34171 1.95118 7.14645 2.14645L7.85355 2.85355ZM0.146447 2.85355L3.64645 6.35355L4.35355 5.64645L0.853553 2.14645L0.146447 2.85355ZM4.35355 6.35355L7.85355 2.85355L7.14645 2.14645L3.64645 5.64645L4.35355 6.35355Z\" fill=\"currentColor\"/> </svg>",
  "chevron-down": "<svg width=\"12\" height=\"12\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M1 5L8 12L15 5\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "chevron-right": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M6 12L10 8L6 4\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "info-small": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <circle cx=\"8\" cy=\"8\" r=\"7.5\" stroke=\"currentColor\"/> <path d=\"M7.04 11.68C7.04 12.265 7.49 12.715 8.06 12.715C8.63 12.715 9.08 12.265 9.08 11.68C9.08 11.095 8.63 10.645 8.06 10.645C7.49 10.645 7.04 11.095 7.04 11.68ZM11.015 5.92C11.015 4.285 9.935 3.25 8.09 3.25C6.38 3.25 5.18 4.45 5 6.16H6.62C6.68 5.29 7.16 4.63 8.09 4.63C8.96 4.63 9.485 5.17 9.485 5.935C9.485 6.73 8.81 7.21 8.3 7.78C7.64 8.5 7.43 8.89 7.385 9.715H8.855C8.855 9.4 8.96 9.07 9.485 8.53C10.19 7.81 11.015 7.045 11.015 5.92Z\" fill=\"currentColor\"/> </svg>",
  "warning": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <circle cx=\"8\" cy=\"8\" r=\"7.5\" stroke=\"currentColor\"/> <rect x=\"7.5\" y=\"4\" width=\"1\" height=\"6\" rx=\"0.5\" fill=\"currentColor\"/> <rect x=\"7.5\" y=\"11.5\" width=\"1\" height=\"1\" rx=\"0.5\" fill=\"currentColor\"/> </svg>",
  "check-circle-small": "<svg width=\"12\" height=\"13\" viewBox=\"0 0 12 13\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <circle cx=\"6\" cy=\"6.5\" r=\"5.5\" stroke=\"currentColor\"/> <path d=\"M2.625 6.5L4.875 8.75L9.375 4.25\" stroke=\"currentColor\"/> </svg>",
  "tick-small": "<svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M1.5 6L4.5 9L10.5 3\" stroke=\"currentColor\"/> </svg>",
  "plus": "<svg width=\"17\" height=\"17\" viewBox=\"0 0 17 17\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M8.5 0.5V16.5\" stroke=\"currentColor\"/> <path d=\"M0.5 8.5L16.5 8.5\" stroke=\"currentColor\"/> </svg>",
  "new-tab": "<svg width=\"14\" height=\"14\" viewBox=\"0 0 14 14\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M12.625 5.6875V7V10.625C12.625 11.7296 11.7296 12.625 10.625 12.625H3.375C2.27043 12.625 1.375 11.7296 1.375 10.625V3.375C1.375 2.27043 2.27043 1.375 3.375 1.375H7H8.3125\" stroke=\"currentColor\"/> <path d=\"M9.25 1.375H12.625V4.75\" stroke=\"currentColor\"/> <path d=\"M12.25 1.75L8.5 5.5\" stroke=\"currentColor\"/> </svg>",
  "copy-small": "<svg width=\"12\" height=\"12\" viewBox=\"0 0 12 12\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <rect x=\"3.5\" y=\"0.5\" width=\"8\" height=\"8\" rx=\"2\" stroke=\"currentColor\"/> <path d=\"M8.5 8.5V9.5C8.5 10.6046 7.60457 11.5 6.5 11.5H2.5C1.39543 11.5 0.5 10.6046 0.5 9.5V5.5C0.5 4.39543 1.39543 3.5 2.5 3.5H3.5\" stroke=\"currentColor\"/> </svg>",
  "filter": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M3.64681 0.5H12.3532C13.5374 0.5 14.2546 1.80779 13.618 2.80633L10.3919 7.86698C10.136 8.26847 10 8.73472 10 9.21086V14C10 14.8284 9.32843 15.5 8.5 15.5H7.5C6.67157 15.5 6 14.8284 6 14V9.21086C6 8.73472 5.86403 8.26848 5.60808 7.86698L2.38196 2.80633C1.74541 1.80779 2.46263 0.5 3.64681 0.5Z\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "link": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M12 4.5C13.933 4.5 15.5 6.067 15.5 8C15.5 9.933 13.933 11.5 12 11.5\" stroke=\"currentColor\"/> <path d=\"M12 4.5H9\" stroke=\"currentColor\"/> <path d=\"M12 11.5H9\" stroke=\"currentColor\"/> <path d=\"M4 11.5C2.067 11.5 0.5 9.933 0.5 8C0.5 6.067 2.067 4.5 4 4.5\" stroke=\"currentColor\"/> <path d=\"M4 4.5H7\" stroke=\"currentColor\"/> <path d=\"M4 11.5H7\" stroke=\"currentColor\"/> <path d=\"M4 8H12\" stroke=\"currentColor\"/> </svg>",
  "question-circle": "<svg width=\"13\" height=\"13\" viewBox=\"0 0 13 13\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <circle cx=\"6.5\" cy=\"6.5\" r=\"5.5\" stroke=\"currentColor\"/> <path d=\"M5.85661 9.23455C5.85661 9.66719 6.15586 10 6.53491 10C6.91397 10 7.21322 9.66719 7.21322 9.23455C7.21322 8.8019 6.91397 8.4691 6.53491 8.4691C6.15586 8.4691 5.85661 8.8019 5.85661 9.23455ZM8.5 4.97464C8.5 3.76545 7.7818 3 6.55486 3C5.41771 3 4.6197 3.88748 4.5 5.15214H5.57731C5.61721 4.50872 5.93641 4.0206 6.55486 4.0206C7.13342 4.0206 7.48254 4.41997 7.48254 4.98574C7.48254 5.57369 7.03367 5.92868 6.69451 6.35024C6.25561 6.88273 6.11596 7.17116 6.08604 7.7813H7.06359C7.06359 7.54834 7.13342 7.30428 7.48254 6.90491C7.95137 6.37242 8.5 5.80666 8.5 4.97464Z\" fill=\"currentColor\"/> </svg>",
  "right-arrow-long-small": "<svg width=\"14\" height=\"12\" viewBox=\"0 0 14 12\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M9.4751 3L12.4751 6L9.4751 9\" stroke=\"currentColor\" stroke-linecap=\"round\"/> <path d=\"M1.375 6H12.25\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>",
  "moon": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <path d=\"M13.5 9.5C12.7 12.4 10.2 14.5 7.3 14.5C3.9 14.5 1.5 11.8 1.5 8.6C1.5 5.6 3.7 3 6.5 2.5C5.9 3.4 5.6 4.5 5.6 5.6C5.6 8.7 8.1 11.1 11.1 11.1C12 11.1 12.8 10.6 13.5 9.5Z\" stroke=\"currentColor\" stroke-linejoin=\"round\"/> </svg>",
  "sun": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"> <circle cx=\"8\" cy=\"8\" r=\"3\" stroke=\"currentColor\"/> <path d=\"M8 0.5V2.5M8 13.5V15.5M0.5 8H2.5M13.5 8H15.5M2.7 2.7L4.1 4.1M11.9 11.9L13.3 13.3M2.7 13.3L4.1 11.9M11.9 4.1L13.3 2.7\" stroke=\"currentColor\" stroke-linecap=\"round\"/> </svg>"
};

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }
  function rest(props, omit) {
    var o = {};
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k) && omit.indexOf(k) < 0) o[k] = props[k];
    return o;
  }

  function Icon(props) {
    var svg = ICONS[props.name];
    if (!svg) return null;
    var size = props.size;
    if (size) svg = svg.replace(/width="[^"]*"/, 'width="' + size + '"').replace(/height="[^"]*"/, 'height="' + size + '"');
    return h('span', { className: cx('geo-icon', props.className), 'aria-hidden': props.label ? undefined : 'true', role: props.label ? 'img' : undefined, 'aria-label': props.label, style: { display: 'inline-flex', color: props.color ? 'var(--' + props.color + ')' : undefined }, dangerouslySetInnerHTML: { __html: svg } });
  }

  function Button(props) {
    var variant = props.disabled ? 'disabled' : props.variant || 'primary';
    if (variant === 'text') return h('button', Object.assign({ type: 'button' }, rest(props, ['variant', 'small', 'icon', 'className', 'children']), { className: cx('geo-btn-text', props.className) }), props.children);
    return h('button', Object.assign({ type: 'button' }, rest(props, ['variant', 'small', 'icon', 'className', 'children']), { className: cx('geo-btn', 'geo-btn-' + variant, props.small && 'geo-btn-small', props.className) }), props.icon || null, props.children);
  }

  function Tag(props) {
    return h('span', Object.assign({}, rest(props, ['className']), { className: cx('geo-tag', props.className) }));
  }

  function Badge(props) {
    return h('span', { className: cx('geo-badge', props.tone === 'new' && 'geo-badge-new', props.className) }, props.children);
  }

  function Chip(props) {
    var tag = props.href ? 'a' : props.onClick ? 'button' : 'span';
    return h(tag, Object.assign({}, rest(props, ['className', 'children']), tag === 'button' ? { type: 'button' } : {}, { className: cx('geo-chip', props.className) }), props.children);
  }

  function StatusChip(props) {
    var tone = props.tone || 'low';
    return h('span', { className: cx('geo-status', 'geo-status-' + tone, props.className), title: props.title }, h('span', { className: 'geo-status-dot', 'aria-hidden': 'true' }), props.children);
  }

  function PillToggle(props) {
    var options = props.options || [];
    return h('div', { className: cx('geo-pill-group', props.className), role: 'group', 'aria-label': props.label },
      props.label ? h('span', { className: 'geo-pill-label', 'aria-hidden': 'true' }, props.label) : null,
      options.map(function (o) {
        var pressed = o.value === props.value;
        return h('button', { key: o.value, type: 'button', className: 'geo-pill', 'aria-pressed': pressed ? 'true' : 'false', onClick: function () { if (props.onChange) props.onChange(o.value); } },
          o.label, o.count != null ? h('span', { className: 'geo-pill-count' }, o.count) : null);
      }));
  }

  function Tabs(props) {
    var tabs = props.tabs || [];
    return h('div', { className: cx('geo-tabs', props.className) },
      h('div', { className: 'geo-tabs-row', role: 'tablist', 'aria-label': props.label },
        tabs.map(function (t) {
          var selected = t.value === props.value;
          return h('button', { key: t.value, type: 'button', role: 'tab', className: 'geo-tab', 'aria-selected': selected ? 'true' : 'false', 'aria-disabled': t.disabled ? 'true' : undefined, tabIndex: selected ? 0 : -1, onClick: function () { if (!t.disabled && props.onChange) props.onChange(t.value); } },
            t.label, t.badge != null ? h(Badge, null, t.badge) : null);
        })));
  }

  function SideNav(props) {
    var items = props.items || [];
    return h('nav', { className: cx('geo-sidenav', props.className), role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': props.label || 'Sections' },
      items.map(function (it, i) {
        var selected = it.value === props.value;
        return h('button', { key: it.value, type: 'button', role: 'tab', className: 'geo-sidenav-item', 'aria-selected': selected ? 'true' : 'false', onClick: function () { if (props.onChange) props.onChange(it.value); } },
          props.numbered === false ? null : h('span', { className: 'geo-sidenav-num' }, String(i + 1)), it.label);
      }));
  }

  function PageHeader(props) {
    return h('header', { className: cx('geo-pageheader', props.className) },
      h('div', { className: 'geo-pageheader-main' },
        props.eyebrow ? h('div', { className: 'geo-eyebrow' }, props.eyebrow) : null,
        h('h1', { className: 'geo-pageheader-title' }, props.title),
        props.subtitle ? h('p', { className: 'geo-pageheader-sub' }, props.subtitle) : null),
      props.meta ? h('div', { className: 'geo-pageheader-meta' }, props.meta) : null);
  }

  function Card(props) {
    return h('div', { className: cx('geo-card', props.selected && 'geo-card-selected', props.className), 'aria-current': props.selected ? 'true' : undefined },
      props.eyebrow ? h('div', { className: 'geo-card-eyebrow' }, props.eyebrow) : null,
      props.title ? h('h3', { className: 'geo-card-title' }, props.title) : null,
      props.children != null ? h('div', { className: 'geo-card-body' }, props.children) : null,
      props.footer ? h('div', { className: 'geo-card-band' }, props.footer) : null);
  }

  function StatCard(props) {
    return h('div', { className: cx('geo-card', props.className) },
      h('div', { className: 'geo-stat-value' }, props.value),
      h('div', { className: 'geo-stat-label' }, props.label));
  }

  // Geo's info-small draws a question mark, so only warning and success carry an icon.
  var CALLOUT_ICON = { warning: 'warning', success: 'check-circle-small' };
  function Callout(props) {
    var tone = props.tone || 'info';
    return h('div', { className: cx('geo-callout', tone !== 'info' && 'geo-callout-' + tone, props.className), role: tone === 'warning' ? 'note' : undefined },
      CALLOUT_ICON[tone] ? h('span', { className: 'geo-callout-icon' }, h(Icon, { name: CALLOUT_ICON[tone] })) : null,
      h('div', { className: 'geo-callout-body' }, props.title ? h('span', { className: 'geo-callout-title' }, props.title, ' ') : null, props.children));
  }

  function Table(props) {
    var cols = props.columns || [];
    var rows = props.rows || [];
    return h('div', { className: 'geo-table-wrap' },
      h('table', { className: cx('geo-table', props.compact && 'geo-table-compact', props.className) },
        h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { key: c.key, scope: 'col', style: c.width ? { width: c.width } : undefined }, c.label); }))),
        h('tbody', null, rows.map(function (r, i) {
          return h('tr', { key: r.id != null ? r.id : i, className: r.highlight ? 'geo-row-highlight' : undefined },
            cols.map(function (c) { return h('td', { key: c.key }, r[c.key]); }));
        }))));
  }

  function Code(props) {
    if (props.block) return h('pre', { className: cx('geo-code', props.className) }, props.children);
    return h('code', { className: cx('geo-code-inline', props.className) }, props.children);
  }

  function Figure(props) {
    return h('figure', { className: cx('geo-figure', props.className) },
      h('div', { className: 'geo-figure-frame' }, props.children),
      props.caption ? h('figcaption', { className: 'geo-figure-caption' }, props.caption) : null);
  }

  function Disclosure(props) {
    return h('details', { className: cx('geo-disclosure', props.small && 'geo-disclosure-sm', props.className), open: props.defaultOpen || undefined },
      h('summary', null, h('span', null, props.summary), h('span', { className: 'geo-disclosure-chevron' }, h(Icon, { name: 'chevron-down-small' }))),
      h('div', { className: 'geo-disclosure-body' }, props.children));
  }

  function Term(props) {
    return h('dfn', { className: cx('geo-term', props.className), tabIndex: 0, 'aria-describedby': props.id },
      props.children, h('span', { className: 'geo-term-tip', role: 'tooltip', id: props.id }, props.definition));
  }

  function Glossary(props) {
    var items = props.items || [];
    return h('div', { className: props.className },
      props.title ? h('h4', { className: 'geo-glossary-title' }, props.title) : null,
      h('dl', { className: 'geo-glossary' }, items.reduce(function (acc, it) {
        acc.push(h('dt', { key: it.term + ':t' }, it.term));
        acc.push(h('dd', { key: it.term + ':d' }, it.definition));
        return acc;
      }, [])));
  }

  function Divider(props) {
    return h('hr', { className: cx('geo-divider', props.dashed && 'geo-divider-dashed', props.className) });
  }

  function Input(props) {
    var input = h('input', Object.assign({}, rest(props, ['search', 'className']), { className: cx('geo-input', props.search && 'geo-input-search', props.className) }));
    if (!props.search) return input;
    return h('div', { className: 'geo-input-wrap' }, h('span', { className: 'geo-input-icon' }, h(Icon, { name: 'search' })), input);
  }

  function Checkbox(props) {
    var checked = props.checked;
    var icon = checked === true ? h(Icon, { name: 'check' }) : checked === false ? null : h(Icon, { name: 'minus' });
    var box = h('button', { type: 'button', role: 'checkbox', className: 'geo-checkbox', 'aria-checked': checked === null ? 'mixed' : checked ? 'true' : 'false', 'aria-label': props.label ? undefined : props['aria-label'], onClick: props.onChange, id: props.id }, icon);
    if (!props.label) return box;
    return h('label', { className: 'geo-checkbox-label' }, box, props.label);
  }

  function Toggle(props) {
    return h('button', { type: 'button', role: 'switch', className: cx('geo-toggle', props.className), 'aria-checked': props.checked ? 'true' : 'false', 'aria-label': props['aria-label'], onClick: props.onChange, id: props.id },
      h('span', { className: 'geo-toggle-knob' }));
  }

  window.Geo = Object.assign(window.Geo || {}, {
    Icon: Icon, Button: Button, Tag: Tag, Badge: Badge, Chip: Chip, StatusChip: StatusChip, PillToggle: PillToggle,
    Tabs: Tabs, SideNav: SideNav, PageHeader: PageHeader, Card: Card, StatCard: StatCard, Callout: Callout, Table: Table,
    Code: Code, Figure: Figure, Disclosure: Disclosure, Term: Term, Glossary: Glossary, Divider: Divider,
    Input: Input, Checkbox: Checkbox, Toggle: Toggle,
    iconNames: Object.keys(ICONS),
  });
})();
