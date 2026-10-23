# Stylesheet ownership

`app/layout.tsx` imports the existing Tailwind/global baseline and component baseline, followed by these shared styles. The former `consumer.css` override file has been removed and its rules organized and formatted by responsibility:

- `motion.css`: short entrance animations, a limited card stagger, dialog/chat feedback and pointer interactions. Runs only when reduced motion is not requested; no JS animation dependency or hidden-content initialization. Loaded last and owns timing rather than layout.
- `tokens.css`: shared colors, radii, shadows and timing values.
- `foundation.css`: page typography, shared actions, spacing and motion preferences.
- `navigation.css`: header grid, navbar insets, responsive actions and skip link.
- `onboarding.css`: introduction, confirmation and taste-entry layout.
- `discoveries.css`: Passport, cards, explanations and day-out layout.
- `dialogs.css`: account and feedback dialog layout.
- `assistant.css`: Ask TastePassport only; one content scroller, pinned composer and background scroll lock. Legacy drawer rules were removed from the baseline files.
- `controls.css`: shared input/select styling and focus behavior. Loads after component styles so dropdowns retain one custom arrow and enough text padding. Do not restore native select appearance in component styles. Native checkbox sizing remains scoped to the assistant.

Compound controls have one border owner: their wrapper. Their inner input/select has no border, outline or glow. Standalone fields use their own border. Keyboard focus remains visible through the wrapper border change; button/link focus rings are retained. Keep these rules in `controls.css` rather than adding competing focus rules elsewhere.

Opened select menus use `appearance: base-select` and `::picker(select)` inside a feature query. This styles option rows, selection, scrolling and the popup surface in supporting browsers while preserving real select elements and React change handlers. Unsupported browsers retain the platform picker. Chromium 154 checks verified open-menu styles at 390/1280px and a real option click dispatching change; automated keyboard selection was not established in that headless check.

The old global/component baselines remain and have not been represented as a complete CSS rewrite. When migrating an existing rule, remove the superseded declaration where practical. Avoid appending a new catch-all override file. Use the browser layout assertions to catch cascade changes at all supported widths.
