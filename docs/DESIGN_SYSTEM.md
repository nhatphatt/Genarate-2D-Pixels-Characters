# Design System — Supabase-Inspired

A dark-mode-native visual system for the 2D Pixel Art Game Character Engine, modeled on Supabase's developer-platform aesthetic.

---

## 1. Visual Theme & Atmosphere

A dark-mode-native developer surface that channels the aesthetic of a premium code editor — deep black backgrounds (`#0f0f0f`, `#171717`) with emerald green accents (`#3ecf8e`, `#00c573`). Born in a terminal window, evolved into a marketing surface, never losing its developer soul.

Typography is built on **Circular** — a geometric sans-serif with rounded terminals that softens the technical edge. The hero text is compressed to its absolute minimum vertical space (line-height 1.00), creating dense, impactful statements. **Source Code Pro** appears sparingly for uppercase technical labels (1.2px letter-spacing) — the developer-console marker.

Depth comes from a sophisticated **border hierarchy** (`#242424` → `#2e2e2e` → `#363636` → `#393939`), not box-shadows. The green accent is an **identity marker** — used selectively in the logo, link colors, and accent borders.

Key characteristics:
- Dark-mode-native: near-black backgrounds — never pure black
- Emerald green brand accent used sparingly
- Circular at weight 400 for nearly everything; 500 only for buttons and nav
- Pill (9999px) for primary CTAs; 6px for secondary; 8–16px for cards
- Translucent layering via HSL/RGBA borders
- Minimal shadows — depth through border contrast

---

## 2. Color Tokens

### Brand
| Token | Hex | Use |
| --- | --- | --- |
| `--brand-green` | `#3ecf8e` | Logo, accent highlights, icon tints |
| `--brand-link` | `#00c573` | Interactive green for links/actions |
| `--brand-border` | `rgba(62, 207, 142, 0.30)` | Subtle green accent border |
| `--brand-glow` | `rgba(62, 207, 142, 0.10)` | Soft brand surface tint |

### Neutral scale (dark mode)
| Token | Hex | Role |
| --- | --- | --- |
| `--neutral-0` | `#0f0f0f` | Deepest surface; primary button bg |
| `--neutral-50` | `#171717` | Page background; primary canvas |
| `--neutral-100` | `#1c1c1c` | Elevated surface |
| `--neutral-200` | `#242424` | Subtle dividers |
| `--neutral-300` | `#2e2e2e` | Standard card/tab borders |
| `--neutral-400` | `#363636` | Prominent borders, dividers |
| `--neutral-500` | `#393939` | Secondary borders |
| `--neutral-600` | `#434343` | Tertiary borders, dark accents |
| `--neutral-700` | `#4d4d4d` | Heavy secondary text |
| `--neutral-800` | `#898989` | Muted text, link color |
| `--neutral-900` | `#b4b4b4` | Secondary link text |
| `--neutral-1000` | `#efefef` | Light surface |
| `--neutral-1100` | `#fafafa` | Primary text, button text |

### Semantic accents (Radix-inspired)
| Token | Approx HSL | Use |
| --- | --- | --- |
| `--accent-violet` | `hsl(251, 63%, 63%)` | Vibrant accent |
| `--accent-crimson` | `hsl(348, 75%, 55%)` | Warning / alert |
| `--accent-tomato` | `hsl(10, 80%, 55%)` | Error |
| `--accent-orange` | `hsl(28, 90%, 55%)` | Warm accent |
| `--accent-yellow` | `hsl(46, 90%, 55%)` | Attention |

### Surface & overlay
- **Glass dark**: `rgba(41, 41, 41, 0.84)` — translucent dark overlay
- **Slate alpha**: `hsla(210, 88%, 16%, 0.031)` — ultra-subtle blue wash
- **Backdrop**: `rgba(0, 0, 0, 0.70)` with 8px backdrop-blur

### Shadows (used sparingly)
- **Focus**: `rgba(0, 0, 0, 0.10) 0px 4px 12px`
- **Drawer / Modal**: `rgba(0, 0, 0, 0.50) 0px 16px 48px`
- No decorative drop-shadows. Borders carry the depth.

---

## 3. Typography

### Families
- **Primary**: `Circular`, with fallbacks `Inter, "Helvetica Neue", Helvetica, Arial, sans-serif`
- **Mono**: `"Source Code Pro", "Office Code Pro", Menlo, monospace`

### Hierarchy

| Role | Family | Size | Weight | Line-height | Letter-spacing |
| --- | --- | --- | --- | --- | --- |
| Display Hero | Circular | 72px (4.50rem) | 400 | **1.00** | normal |
| Section Heading | Circular | 36px (2.25rem) | 400 | 1.25 | normal |
| Card Title | Circular | 24px (1.50rem) | 400 | 1.33 | -0.16px |
| Sub-heading | Circular | 18px (1.13rem) | 400 | 1.56 | normal |
| Body | Circular | 16px (1.00rem) | 400 | 1.50 | normal |
| Nav Link | Circular | 14px (0.88rem) | 500 | 1.00–1.43 | normal |
| Button | Circular | 14px (0.88rem) | 500 | 1.14 | normal |
| Caption | Circular | 14px (0.88rem) | 400–500 | 1.43 | normal |
| Small | Circular | 12px (0.75rem) | 400 | 1.33 | normal |
| Code Label | Source Code Pro | 12px (0.75rem) | 400 | 1.33 | 1.2px UPPERCASE |

### Principles
1. **Weight restraint**: 400 default. 500 only for nav/buttons. **No 700**.
2. **1.00 hero leading**: zero-leading hero text is the typographic signature.
3. **Negative tracking** on card titles (-0.16px) — subtle differentiation.
4. **Monospace as ritual**: Source Code Pro UPPERCASE 1.2px for technical labels.
5. **Geometric warmth**: Circular's rounded terminals humanize the surface.

---

## 4. Components

### Buttons

**Primary pill** — primary CTA
```
bg: #fafafa, text: #0f0f0f
padding: 8px 32px
radius: 9999px
border: 1px solid #fafafa
hover: bg #efefef
font: Circular 14px / weight 500
```

**Brand pill** — branded primary CTA
```
bg: #3ecf8e, text: #0f0f0f
padding: 8px 32px
radius: 9999px
border: 1px solid #3ecf8e
hover: bg #00c573
```

**Secondary pill** — alongside primary
```
bg: #171717, text: #fafafa
padding: 8px 32px
radius: 9999px
border: 1px solid #2e2e2e
hover: border #4d4d4d
opacity: 0.92
```

**Ghost / icon button**
```
bg: transparent, text: #fafafa
padding: 8px
radius: 6px
border: 1px solid transparent
hover: bg #1c1c1c, border #2e2e2e
```

### Cards & containers
```
bg: #171717
border: 1px solid #2e2e2e
radius: 8–16px
padding: 16–24px
no box-shadow; hover: border #363636
```

### Tabs / Pills
```
border: 1px solid #2e2e2e
radius: 9999px
active: bg #1c1c1c, border #393939, text #fafafa
inactive: text #898989
```

### Inputs
```
bg: #0f0f0f
border: 1px solid #2e2e2e
radius: 6px
padding: 10px 12px
text: #fafafa, placeholder: #4d4d4d
focus: border #3ecf8e, no ring
```

### Links
- **Brand**: `#3ecf8e` → hover `#00c573`
- **Primary**: `#fafafa`
- **Secondary**: `#b4b4b4`
- **Muted**: `#898989`

### Navigation
```
bg: rgba(15, 15, 15, 0.80) + 8px backdrop-blur
border-bottom: 1px solid #2e2e2e
height: 56px
sticky top
logo: green #3ecf8e icon + "PixelEngine" wordmark
links: Circular 14px / 500 / #b4b4b4 → hover #fafafa
```

---

## 5. Layout

### Spacing scale (8px base)
`1 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 90 · 96 · 128`

Notable jumps for major section spacing: 48 → 64 → 96 → 128.

### Containers
- Centered max-width content (≤1280–1600px)
- Full-width dark sections with constrained inner content
- Generous section padding (90–128px on desktop, 48–64px on mobile)
- Tight intra-section spacing (16–24px)

### Border radius scale
- **6px** — small / standard (ghost button, input)
- **8px** — comfortable (card body)
- **12px** — medium panel
- **16px** — feature card / large container
- **9999px** — pill (CTA, tab, badge)

### Whitespace philosophy
- Cinematic section spacing, dense content blocks
- Borders define separation, not whitespace + shadow

---

## 6. Depth & Elevation

| Level | Treatment | Use |
| --- | --- | --- |
| 0 — flat | border `#2e2e2e` | Default surface |
| 1 — subtle | border `#363636`/`#393939` | Hover, interactive |
| 2 — focus | shadow `0 4px 12px rgba(0,0,0,0.10)` | Focus ring |
| 3 — brand | border `rgba(62,207,142,0.30)` | Brand-elevated state |

In a dark theme, shadows are nearly invisible. The green accent border at 30% opacity becomes the elevation signal.

---

## 7. Do's & Don'ts

### Do
- Use near-black backgrounds (`#0f0f0f`, `#171717`)
- Apply Supabase green sparingly — identity, not decoration
- Default Circular weight to 400; 500 only for buttons and nav
- Set hero line-height to 1.00
- Build depth via border hierarchy
- Use pill (9999px) for primary CTAs and tabs
- Use Source Code Pro UPPERCASE for technical labels

### Don't
- Don't add hard-offset box-shadows (`shadow-[4px_4px_0_…]`) — this is brutalist, not Supabase
- Don't use weight 700/900
- Don't apply green to large surfaces — borders, links, small accents only
- Don't use warm reds/oranges as primary design — semantic only
- Don't increase hero line-height above 1.00
- Don't use border radius between 16px and 9999px on buttons

---

## 8. Responsive Behavior

| Breakpoint | Width | Behavior |
| --- | --- | --- |
| Mobile | <600px | Single column, stacked, condensed nav |
| Desktop | ≥600px | Multi-column grids, full nav |

Hero scales 72 → 40px on mobile. Section spacing collapses 96–128 → 48–64.

---

## 9. Quick Reference

```
Background:    #0f0f0f (deepest) · #171717 (page)
Surface:       #1c1c1c (elevated)
Text:          #fafafa (primary) · #b4b4b4 (secondary) · #898989 (muted)
Brand green:   #3ecf8e (brand) · #00c573 (link/hover)
Borders:       #242424 (subtle) · #2e2e2e (standard) · #363636 (prominent)
Brand border:  rgba(62, 207, 142, 0.30)
Mono labels:   Source Code Pro · 12px · UPPERCASE · 1.2px tracking
```

### Iteration guide
1. Start on `#171717` — everything is dark-mode-native.
2. Green is the brand identity marker — links, logo, accent borders only.
3. Depth is borders, not shadows.
4. Weight 400 default, 500 for interactive elements.
5. Hero line-height 1.00 is the signature move.
6. Pill 9999px for primary, 6px for secondary, 8–16px for cards.
