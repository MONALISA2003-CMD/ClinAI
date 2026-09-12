# ClinAI V17: Mobile and AI presentation polish

## Purpose

V17 implements the agreed presentation refinement after mobile review of the Clinical Intelligence Engine. The goal is a proper touch-first healthcare application experience on phones, an intelligent responsive layout across tablet and laptop, and AI output that reads like ClinAI rather than a raw model response.

## Implemented

### Mobile experience

- Declared `device-width` viewport in the App Router layout.
- Added global width and overflow guards to prevent horizontal drift.
- Added mobile text-size controls so browser text autosizing does not unexpectedly change the layout.
- Kept the bottom navigation touch-first.
- Constrained panels, forms, media and AI content to the available viewport.
- Improved AI spacing and readable type sizes on phone widths.
- Kept a separate tablet breakpoint instead of treating tablets as oversized phones.
- Made AI prompt chips horizontally scrollable without widening the page.
- Prevented the AI input and response from creating accidental horizontal overflow.

### AI presentation

- Removed the Gemini model name and API version from the normal user interface.
- Replaced technical status text with `AI ready` and `ClinAI intelligence is available`.
- Added human-language loading feedback: `Reviewing the record…`.
- Added readable role labels such as Leadership, Doctor and Nurse.
- Added a structured AI response renderer for headings, paragraphs and lists.
- Removes Markdown decoration such as `**`, `#` and list markers from displayed AI output.
- Backend prompts now explicitly request plain text without Markdown syntax.
- Preserved the human-review boundary.

## Safety boundary

V17 does not change clinical authority. ClinAI remains a decision-support system. It does not autonomously diagnose, prescribe, discharge, alter clinical records, authorize payments, or make irreversible decisions.

## Verification

The following checks passed after the changes:

- V17 mobile and AI presentation audit
- V16 AI intelligence audit
- V15 full-system audit
- V14 integration audit

A full Next.js production build still depends on the normal Vercel/Render dependency installation environment; the working container does not include the project `node_modules`.
