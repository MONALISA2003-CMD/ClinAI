# ClinAI Multilingual Intelligence V1

## Supported languages
- English
- Kiswahili
- Luganda
- Runyankore

## Architecture
User text -> language selection/detection -> clinical concept signals -> Patient 360/context -> deterministic Python intelligence -> configured AI model routing -> safety verification -> requested-language response.

The language layer is assistive. It does not independently diagnose, prescribe, triage, discharge, change medication, or perform irreversible clinical actions.

## Python intelligence
The deterministic intelligence service now provides:
- language detection signals
- multilingual clinical concept extraction for common high-level concepts
- auditable logistic-regression review-signal learning for supplied datasets
- existing clinical calculations, trend analysis and screening operations

The ML endpoint is deliberately generic and non-diagnostic. It must not be treated as a clinical model merely because it produces a probability.

## Translation safety
Healthcare translation is instructed to preserve:
- medication names
- numbers
- units
- dates
- safety warnings
- clinical meaning

Source and translated text are screened for known clinical concepts. Missing concepts trigger `human-review-recommended` rather than silently claiming that the translation is safe.

## Public mode
Public health information supports the four languages but does not receive patient records. It is informational and not a diagnostic service.

## Clinical mode
Authenticated users can choose the response language in ClinAI Intelligence. The selected language is included in the AI context so model output is produced directly in the requested language instead of relying only on post-processing translation.

## Safety boundary
WHO guidance emphasizes human rights, safety, accountability, equity, privacy and governance for AI in health. ClinAI therefore keeps professional review mandatory for clinical decisions and treats multilingual/ML output as decision support rather than autonomous medical action.

## Evaluation requirement
Language support must be evaluated with real-world-style synthetic cases covering spelling variation, code-switching, abbreviations, local terminology, ambiguity and clinically important numbers/units before any production clinical reliance.
