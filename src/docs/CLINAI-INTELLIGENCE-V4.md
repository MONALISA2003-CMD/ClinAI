# ClinAI Intelligence V4

## Purpose
V4 makes the clinician-facing AI behave like a professional assistant while keeping structured intelligence internal.

## Fast path
Simple factual requests are classified before expensive model work. Supported fast intents include facility appointment count, patient count, active encounters, open tasks, queue status, latest blood pressure and latest laboratory result when a patient is selected. These paths query authoritative tenant-scoped records directly and return a natural-language response in the selected supported language.

## Model routing
The existing multi-provider model router remains in place. Quick requests prefer fast configured providers; complex requests retain the reasoning path. Provider calls have bounded timeouts and Gemini free-tier spacing defaults to zero unless an operator explicitly configures a delay.

## Reasoning
Complex requests continue to combine retrieval, deterministic Python analytics, ML review signals, cross-module intelligence, evidence/provenance and a safety boundary before generating the user-facing response.

## Output contract
The internal structured representation is never intended for direct clinician display. The API's clinician answer is a formatted natural-language string. The web UI also defensively converts legacy structured responses into professional headings instead of displaying JSON.

## Multilingual
Responses support English, Kiswahili, Kinyarwanda, Luganda, Runyankore and controlled Alur translation. Language-specific policy remains conservative for lower-resource clinical NLP. Safety restrictions are language-independent.

## Clinical safety
ClinAI does not autonomously diagnose, prescribe, change medication, discharge, authorize payment or execute irreversible clinical decisions. Ambiguous low-resource-language clinical input is not silently inferred.
