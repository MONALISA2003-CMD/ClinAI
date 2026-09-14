# ClinAI Cerebras GPT-OSS 120B Root Cause and Fix

## Root cause

The Cerebras request was failing because the previous OpenAI-compatible adapter could send `tools` and `response_format: json_schema` in the same Chat Completions request. Cerebras documents that `tools` and `response_format` cannot be used in the same request. The same adapter also used strict JSON Schema without closing the schema object with `additionalProperties: false`, which is required by Cerebras strict structured outputs.

## Fix

1. Tool rounds are now sent without `response_format`.
2. The final no-tool round requests strict `json_schema` output.
3. The ClinAI response schema explicitly sets `additionalProperties: false`.
4. Cerebras GPT-OSS 120B receives explicit `reasoning_effort` (`high` for full reasoning, `low` for quick requests).
5. Exhausted provider errors are no longer exposed to clinicians as raw provider messages.
6. A regression audit prevents this incompatibility from returning.

## Expected behavior

For a normal text request:

`ClinAI -> GPT-OSS 120B on Cerebras -> strict JSON response`

For a tool-using request:

`ClinAI -> Cerebras tool round(s) -> final no-tool round -> strict JSON response`

For an image/audio/video request, capability routing prevents text-only Cerebras GPT-OSS from being selected.

No database migration or destructive data operation is required for this fix.
