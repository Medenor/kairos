---
name: Kairos
description: A calm, flat quota dashboard that tells you which AI provider to use right now.
colors:
  paper: "#ffffff"
  paper-warm: "#f5f5f3"
  paper-sunk: "#eeece6"
  ink: "#1a1a18"
  ink-muted: "#5f5e5a"
  ink-faint: "#6b6a65"
  hairline: "rgba(0,0,0,0.12)"
  hairline-strong: "rgba(0,0,0,0.22)"
  signal-green: "#1D9E75"
  signal-amber: "#EF9F27"
  signal-red: "#E24B4A"
  green-text: "#0b6b4c"
  amber-text: "#7a4a00"
  red-text: "#b3261e"
  green-wash: "#eaf3de"
  amber-wash: "#faeeda"
  red-wash: "#fcebeb"
  action: "#0b6b4c"
  danger: "#c62f2d"
  select-blue: "#185fa5"
  select-blue-wash: "#e6f1fb"
  night: "#1a1a18"
  night-raised: "#242422"
  night-sunk: "#2c2c2a"
  night-ink: "#f0ece4"
  night-ink-muted: "#b4b2a9"
  night-ink-faint: "#989690"
  night-green-wash: "#16352b"
  night-amber-wash: "#3a2c12"
  night-red-wash: "#3d1f1e"
  night-action: "#3fc79b"
  night-select-border: "#6aa8e6"
  night-select-wash: "#1d2e42"
typography:
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.5
  answer:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.5
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.5
  value:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.5
  subhead:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  title-small:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  reason:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0.08em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "2px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
components:
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  button-step:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    size: "32px"
  button-action:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  task-tile:
    backgroundColor: "{colors.paper-warm}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  task-tile-selected:
    backgroundColor: "{colors.select-blue-wash}"
    textColor: "{colors.ink}"
  badge:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "3px 8px"
  badge-ok:
    backgroundColor: "{colors.green-wash}"
    textColor: "{colors.green-text}"
  badge-warn:
    backgroundColor: "{colors.amber-wash}"
    textColor: "{colors.amber-text}"
  badge-crit:
    backgroundColor: "{colors.red-wash}"
    textColor: "{colors.red-text}"
  input-number:
    backgroundColor: "{colors.paper-warm}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
    width: "80px"
---

# Design System: Kairos

## Overview

**Creative North Star: "The Dispatch Board"**

Kairos is a board you glance at before sending the next task somewhere. The surfaces are quiet, warm-neutral and flat; the only loud thing on screen is a status colour, and the loudest sentence is the recommendation with its reason. Nothing decorates. Hairline borders, small type and tonal steps do all the structuring, so a reading going amber or an overdue reset is the first thing the eye finds.

The density is compact and the column is narrow: a single 720px lane that works equally on a desktop beside a terminal and on a phone over the LAN. Type is the system font, sized small, with weight 500 doing most of the hierarchy. Controls are restrained and tactile only at the moment of press. Light and dark share one structure; dark mode swaps surface and ink tokens and lightens the status text, nothing else.

**Key Characteristics:**
- Flat: no shadows, depth from surface steps and 0.5px hairlines.
- One lane: a 720px column centred on a sunk page background.
- Status colour is the only chroma; everything else is warm grey.
- System font, small sizes, weight 500 for emphasis.
- Every state is legible without colour (text and badges carry the meaning).

## Colors

A warm-grey neutral field with three status signals and one selection blue; chroma is rationed to meaning.

### Primary
- **Signal Green** (#1D9E75): "healthy quota" fill on gauges and the status dot only.
- **Action Green** (#0b6b4c light, #3fc79b dark): the solid fill of primary actions (empty-state button, form submit), with white text in light and a dark mint text in dark. It exists because white on Signal Green is only 3.4:1.

### Secondary
- **Signal Amber** (#EF9F27): quota under pressure or a reset that is due.
- **Signal Red** (#E24B4A): exhausted quota, overdue or invalid reset.

### Tertiary
- **Selection Blue** (#185fa5 on #e6f1fb wash; #6aa8e6 on #1d2e42 in dark): the selected task tile only. Focus is never blue: it is the Ink outline.
- **Danger** (#c62f2d, white text 5.46:1): destructive solid fills such as Delete and Stop all automatic runs.

### Neutral
- **Paper** (#ffffff): card and panel surface.
- **Warm Paper** (#f5f5f3): secondary surface, tiles and inputs.
- **Sunk Paper** (#eeece6): page background, step buttons, gauge tracks, badges.
- **Ink** (#1a1a18), **Muted Ink** (#5f5e5a), **Faint Ink** (#6b6a65): text; faint ink is tuned to 4.59:1 on Sunk Paper.
- **Hairline** (rgba(0,0,0,0.12)) and **Strong Hairline** (rgba(0,0,0,0.22)): every border.
- **Status text** (#0b6b4c, #7a4a00, #b3261e): the text-safe variants of the three signals; lightened in dark mode (#3fc79b, #EF9F27, #f0807f).
- **Status washes** (#eaf3de, #faeeda, #fcebeb; #16352b, #3a2c12, #3d1f1e in dark): the pale surfaces behind status badges, each paired with its status text at 4.5:1 or better.
- **Night set** (#1a1a18 base, #242422, #2c2c2a, ink #f0ece4): the dark-mode surfaces and ink, chosen by `prefers-color-scheme`.

### Named Rules
**The Chroma-Is-Meaning Rule.** Colour appears only to say something about a quota or a selection. Decorative colour is off limits.

**The Text-Safe Rule.** Status colour on text always uses the `*-text` variant; the raw signal colours are for fills, dots and bars.

**The Tokenise-The-Status Rule.** Every status, selection and action surface is a `--color-*` token with a dark counterpart in `index.css`. A literal hex in a component is a defect.

## Typography

**Display Font:** none; the system stack (`system-ui, -apple-system, sans-serif`)
**Body Font:** the same system stack
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, monospace`, for identifiers and run output

**Character:** A native, unbranded voice that disappears into the OS. Hierarchy comes from size and a single step of weight, never from a second family.

### Hierarchy
- **Answer** (500, 24px, 1.5): the recommended provider name, the largest type on the page.
- **Title** (500, 22px, 1.5): the app name beside the logo.
- **Headline** (500, 20px, 1.5): panel and surplus headlines.
- **Value** (500, 18px): summary-bar figures.
- **Subhead** (600, 16px): panel titles such as New idea.
- **Title-small** (500, 15px): provider names on cards.
- **Body** (400, 14px, 1.5): subtitles, empty-state text, inputs.
- **Reason** (400, 14px, 1.6): the recommendation's explanation; line length held by the 720px lane.
- **Label** (500, 12px, 0.08em, uppercase): section labels. Small meta text is 12px in Faint Ink; nothing is set below 12px.

### Named Rules
**The One Family Rule.** One sans family, one mono. Hierarchy is size plus weight 500, not new fonts.

**The Reason-Reads-Easily Rule.** The reason is 14px at 1.6 line height in Muted Ink: smaller than the provider name, never tighter than body.

## Layout

A single centred column, `max-width: 720px`, with `2rem 1rem` page padding, over the Sunk Paper background. The order follows the decision: the task picker, then the recommendation, then the providers that feed it, then everything else. Sections are 28px apart, cards 10px, with a 2rem header gap. Set-and-forget controls (surplus settings, migration, backups) sit in one closed "Automation and data" disclosure, and an empty panel is not shown at all. Cards use `1rem 1.25rem` padding; rows are flex with 8-12px gaps and wrap. Task tiles use `repeat(auto-fit, minmax(130px, 1fr))` with an 8px gap. Below 480px, steppers and reset controls stack and the primary confirm control goes full width at 40px height; step buttons grow to 36px for touch. Spacing is a loose 4/8/12/16 rhythm, not a strict scale.

## Elevation & Depth

This is a flat system. There are no box-shadows anywhere; depth comes from three tonal steps (Sunk Paper page, Paper card, Warm Paper or Sunk Paper inset controls) and 0.5px hairline borders. The empty state uses a dashed 1px strong hairline instead of a fill. State feedback is a border-colour change on hover or a 1px downward nudge on press. The recommendation box is the one surface with a full-strength 1px hairline.

### Named Rules
**The Flat-By-Default Rule.** No shadows. If something must lift, change its surface step or its border, not add a shadow.

## Shapes

Rounded rectangles, gently curved. Controls, inputs, badges and tiles use 8px; cards and the recommendation box use 12px; the logo uses 6px. Status dots are circles (10px on cards, 14px on the recommendation), gauge tracks are 4px bars with 2px ends, and flag chips use the 8px radius, not a pill. Borders are 0.5px hairlines; selection raises to 1.5px blue, the empty state uses a 1px dashed edge.

## Components

### Buttons
- **Shape:** 8px radius, hairline border.
- **Step button:** 32px square (36px on phones), Sunk Paper fill, Ink text; presses down 1px and shifts to Warm Paper on `:active`.
- **Confirm / clear:** Sunk Paper fill, 12px text, 32px min height (40px on phones).
- **Action:** Action Green fill, 14px/500 text, 8px 16px padding. Used for the empty-state call to action and form submit.
- **Focus:** every control gets one global ring, a 2px Ink outline offset by 2px (`:focus-visible` in `index.css`).

### Provider card (signature)
A native `<details>`. Collapsed, the summary is a glance: dot, name, cost, status badge and one read-only line per quota (label, reading, a 4px gauge, reading age). Opened, the glance is replaced by steppers, "Still current", reset tracking, the card actions and flags. A card with an unread quota starts opened. Readings always state their direction ("62% used", "18% left") and a gauge always draws the share used; a balance is an amount plus a state, never a percentage. Gauges carry `role="progressbar"`.

### Cards / Containers
- **Corner Style:** 12px
- **Background:** Paper on the Sunk Paper page
- **Shadow Strategy:** none; see Elevation
- **Border:** 0.5px Hairline
- **Internal Padding:** 1rem 1.25rem

### Inputs / Fields
- **Style:** Warm Paper or Paper fill, 0.5px hairline, 8px radius; number fields 80px wide at 13px.
- **Focus:** number inputs swap the border to Focus Blue (#378ADD) with the outline removed.
- **Range:** 4px track in Sunk Paper, 16px round Ink thumb.

### Task tiles (signature)
Auto-fit grid of tiles in Warm Paper with a hairline border; name 13px/500 over a 11px Muted Ink description. Hover strengthens the border; selected becomes a 1.5px Selection Blue border on the blue wash.

### Gauges and badges
- **Gauge:** a 4px bar on a Sunk Paper track, width and colour transition over 0.2s.
- **Badge / reset state:** 11px text, 2-3px vertical padding, 8px radius; neutral by default, green, amber or red tinted for countdown, due and overdue.
- **Flags:** hairline-bordered chips, 11px Muted Ink.

### Recommendation box
Paper card with a 14px status dot beside the provider name (20px/500), the reason beneath in 13px Muted Ink, then hairline-separated sections for alternatives and a collapsible list of excluded providers.

## Do's and Don'ts

### Do:
- **Do** use the `--color-*` and `--radius-md` / `--radius-lg` tokens for every new surface, border and radius, with a dark counterpart.
- **Do** ask before an action that wipes data (Clear readings, Delete), let Esc back out, and start focus on the safe choice.
- **Do** pair every status colour with a text label or badge so meaning survives without colour.
- **Do** use the `*-text` colour variants for any coloured text.
- **Do** keep controls at least 32px (36-40px on phones) and add `touch-action: manipulation`.
- **Do** give every interactive control a visible `:focus-visible` treatment (a 2px Ink outline, offset 2px, is the established pattern).

### Don't:
- **Don't** add box-shadows, gradients or glass effects; depth is tonal.
- **Don't** introduce a second font family or weights above 600.
- **Don't** hardcode hex values in a component.
- **Don't** set text below 12px or show a number without its direction.
- **Don't** use raw signal colours for text on pale backgrounds.
- **Don't** add decorative colour, illustration or iconography with no quota meaning.
