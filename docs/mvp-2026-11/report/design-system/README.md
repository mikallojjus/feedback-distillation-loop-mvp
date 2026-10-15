Geo is a network for organizing knowledge that we can collectively govern and trust. The interface is quiet and editorial: near-white surfaces, near-black type set in Calibre, hairline grey borders, and one strong blue (`ctaPrimary`) that marks the action that matters. Colour beyond that is rare and means something.

## Content fundamentals

- Write in sentence case everywhere: titles, buttons, tabs, menu items. "Join spaces", "Featured rankings", "Community calls", never Title Case.
- Buttons are verbs, one or two words: "Publish", "Accept", "Decline", "Add type", "Log in". Secondary choices are plain: "Not now", "Skip", "Show more" / "Show less".
- Name things by what people know them as in Geo: spaces, entities, claims, proposals, bounties, curators. Don't explain the system's internals in the UI.
- Address the reader as "you" only when it helps; most UI copy is a bare label. No exclamation marks in UI chrome, no emoji.
- Numbers are figures ("15 skills", "7 of 15"), dates short ("9 Oct", "11 October 2026").
- Lead with the outcome. A notice or empty state says what happened and what to do next in one sentence.

## Visual foundations

### Colour
Colour comes in two layers. Style everything with the **role tokens**; they change with the theme. **Geo's own palette** (`white`, `text`, `ctaPrimary`, `grey-01` to `grey-05`, and the rest) keeps its exact values in every theme. It is the reference the roles point at in light mode, and it is the right choice only for something that must not change with the theme, such as the white label on the success and error buttons.

| Role | Light (Geo) | Use |
|---|---|---|
| `surface` | `white` | page background |
| `surface-raised` | `white` | cards, menus, inputs, secondary buttons, pills |
| `surface-sunken` | `grey-01` | table headers, code, summary bands, menu hover |
| `surface-hover` | `bg` | hover fill of secondary and ghost buttons |
| `ink` / `ink-muted` / `ink-faint` | `text` / `grey-04` / `grey-03` | primary text / secondary text / placeholders and disabled |
| `border` / `border-control` / `rule` | `grey-02` / `grey-02` / `divider` | card and table borders / control outlines / section hairlines |
| `accent` / `accent-hover` / `accent-tint` / `on-accent` | `ctaPrimary` / `ctaHover` / `ctaTertiary` / `white` | the one accent, its hover, its pale tint, text on it |
| `inverse` / `on-inverse` | `text` / `white` | tooltips, toasts, tertiary button, pressed pill, badges / text on them |
| `danger`, `warning`, `success` | `red-01`, `orange`, `green` | status dots, icons and fills |
| `danger-tint`, `danger-edge`, `success-tint` | `red-02`, `red-03`, `successTertiary` | tinted message blocks |

- Pages sit on `surface`; body text is `ink`, secondary text `ink-muted`. That pair covers almost every screen.
- `accent` is the one accent: the primary button, text buttons, the accordion chevron. Text on an accent fill is `on-accent`, never literal white (it turns navy in dark).
- Status colours mean state, never decoration. In light, `danger`, `warning` and `success` fail contrast as text on white, so use them as dots, icons and fills and keep the label in `ink`.
- `purple` and `pink` are avatar and data hues and stay the same in both themes. Diff highlights are `diff-added` and `diff-deleted`.
- Gradients (`gradient-geo`, `gradient-blue`, and others) are decorative washes for onboarding and hero surfaces, never behind body text. They do not change with the theme and glare on dark: leave them out of dark layouts.

### Themes
- Two themes: `light` (Geo as shipped) and `dark`. Geo itself has no dark mode, so **the dark values are a proposal** derived from Geo's palette and checked for contrast; review them before treating them as final.
- Dark is near-black with a slight cool bias (`surface` #141518), text near-white (`ink` #ececee), the accent lightened to #7b98ff with navy text on it, and the same orange and green as light. Every text pair meets 4.5:1 in dark except placeholder and disabled text in `ink-faint`, which is faint in both themes as in Geo; `border-control` meets 3:1. `border` stays faint on purpose, as Geo's light borders are.
- The theme is chosen by `data-theme="light"` or `data-theme="dark"` on the root element; with no attribute, light applies. `bundle.css` also sets `color-scheme: dark` under the dark theme so form controls and scrollbars follow.
- An artifact that should follow the viewer's system setting as well repeats the dark values under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`, because the compiled tokens only react to the attribute.
- To let a viewer switch, set the same attribute the artifact viewer uses, so its toggle and yours agree:

```html
<button id="theme-toggle" class="geo-btn geo-btn-secondary geo-btn-small">Dark mode</button>
<script>
  const root = document.documentElement;
  const isDark = () => root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const label = () => (isDark() ? 'Light mode' : 'Dark mode');
  const btn = document.getElementById('theme-toggle');
  btn.textContent = label();
  btn.addEventListener('click', () => { root.dataset.theme = isDark() ? 'light' : 'dark'; btn.textContent = label(); });
</script>
```

- Draw SVG diagrams with role tokens (`var(--ink)`, `var(--border-control)`, `var(--accent)`); a literal colour or a fixed palette token can disappear in dark.

### Type
- One family: Calibre, at 400, 500, 600 and 700 (the four files in `fonts/`). Titles are 600 with slight negative tracking; interface labels are 500; reading text is 400.
- Use the named styles, which mirror Geo's Tailwind classes one to one: `text-mainPage` for page titles, `text-largeTitle` for big numbers and empty states, `text-mediumTitle` / `text-smallTitle` for headings, `text-body` (20/29) for reading, `text-button` for controls, `text-metadata` for captions and secondary lines, `text-tableCell` / `text-tableProperty` in tables, `text-breadcrumb` in tooltips, `text-footnote` for fine print.
- `text-entityTitle` steps down at 767px and 409px; `PageHeader` does the same for `text-mainPage` at 767px.
- There is no Geo mono face. Code uses the system `mono` stack in `text-code` (an addition).

### Space, shape and depth
- Spacing is Tailwind's 4px scale. Controls use 6–12px padding (`space-1.5` to `space-3`), cards `space-3`, gaps between tabs `space-6`, between page sections `space-8`.
- Corners are small: `radius` (6px) for controls, chips and tooltips, `radius-lg` (12px) for cards, menus, dialogs and figures, `radius-full` for pills, avatars and toggles.
- Depth is mostly borders, not shadows. Buttons carry a 1px `shadow-light`; menus `shadow-lg`; floating cards `shadow-card`.
- Outlines are drawn as inset shadows, as Geo's `shadow-inner-*` tokens do: a 1px `border-control` ring at rest, 1px `ink` on hover, 2px `ink` on focus. Components build these rings from the role colours (`box-shadow: inset 0 0 0 1px var(--border-control)`) so they follow the theme; Geo's `shadow-inner-*` tokens carry fixed light colours. The 2px ring is the focus indicator for fields and chips; elsewhere focus is a 2px solid `ink` outline offset 2px (an addition, 16:1 on white and 14:1 on dark).

### Layout
- Breakpoints are desktop-first max-widths (`bp-mobile` 639, `bp-md` 767, `bp-lg` 1023, `bp-xl` 1279). Write the desktop layout, then override below each width.
- Overview pages use a side rail of `width-side-rail` (360px, never under 280px) that drops away at `bp-lg`. The navbar is 44px, sticky, with a `rule` bottom border.
- Long documents: a sticky `SideNav` rail beside a single reading column; keep running text near 65 characters.

### Motion and states
- Transitions are short: 100–200ms colour changes, 300ms for the accordion. Hover turns a border to `ink` or swaps a fill to `surface-hover`; there is no lift or scale.
- Disabled controls use `disabled-fill` and `ink-faint` labels.

## Iconography

- Geo draws its own line icons: 1px strokes on a 16px grid (some 12px "small" variants), round caps where a line ends, colour from `currentColor`. They live in the Icons asset group (124 SVGs, copied verbatim from `apps/web/design-system/icons`).
- In a page, inline the SVG markup so it takes the text colour. As an `<img>`, the icons render in black.
- The bundle's `Icon` carries the 18 icons the components use (`Geo.iconNames`).
- No emoji, no filled icon sets from elsewhere. Social marks (Discord, LinkedIn, Reddit) appear only as links out.
- The Geo mark (Logos group) is a black arch inside a ring with a pink-to-violet radial gradient (#FF78E6 to #9542FF). Use it as given; never recolour the ring or draw it flat.

## Components

The `window.Geo` bundle (React 18) covers what a Geo document or report needs: `PageHeader`, `SideNav` and `Tabs` for structure; `Card`, `StatCard`, `Table`, `Figure`, `Code`, `Callout`, `Disclosure`, `Term` and `Glossary` for content; `StatusChip`, `Tag`, `Badge` and `Chip` for state; `Button`, `PillToggle`, `Input`, `Checkbox` and `Toggle` for controls; `Divider` and `Icon`. Every one is also plain CSS: the `geo-*` classes in `components/bundle.css` work in static HTML with the tokens loaded, so a page without React can use the same markup.

Each component's guideline names the source file it was hand-written from. Intentional additions, because Geo's app has no equivalent: `StatusChip` (Geo's chip shape plus a status dot), `Callout` (Geo's tinted message surfaces as a block), `Code`, `Figure`, `Glossary`, `PageHeader` and `StatCard` (compositions of Geo type and surfaces).

## Known gaps in the source

- `apps/web/design-system/theme/colors.ts` and `typography.ts` have drifted from `styles/styles.css`; this system follows the CSS, which is what renders.
- Contrast pairs that Geo uses and that fail WCAG AA are kept exactly and flagged in the token notes: white on `green` and on `red-01` (success and error buttons), `red-01` on `errorTertiary` (error messages), `ctaPrimary` on `ctaTertiary` at 11px (the "New" badge), and `grey-02` borders at 1.38:1. In dark, the message and badge pairs meet the bar and control outlines (`border-control`) reach 3:1; white on `success` and `danger` still fails (the buttons keep Geo's white label in both themes), and `border` stays faint by design.

## Not synced

- Variables skipped: `--color-current` and `--color-transparent` (keywords, not colours); the `animate-*` keyframes (no motion family).
- Icons not converted, because they are built from props or hold several drawings: blank, the editor-* set, gem, geo-logo-large (copied by hand as `geo-mark.svg` instead), menu, order-dots, response-position-icon, sort-arrows, thumb-up, thumb-down, video-small, vote-arrow, x.
- Components were hand-written as CSS plus small React wrappers from the source files named in each guideline, not built from the app (its components depend on Next.js, Radix and framer-motion).
