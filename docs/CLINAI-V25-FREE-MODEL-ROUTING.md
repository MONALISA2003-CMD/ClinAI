# ClinAI V25 Free Model Expansion and Capability Routing

## Scope

ClinAI now supports a capability-aware free-model registry. This expands the existing model pool without changing clinical prompts, deterministic clinical reasoning, CDSS rules, provider credentials, or database schema.

## Added free models

1. Google Gemma 4 31B — multimodal reasoning and document understanding.
2. Google Gemma 4 26B A4B — efficient multimodal reasoning, function calling and structured output.
3. NVIDIA Nemotron 3 Nano Omni — multimodal perception across text, image, video and audio.
4. InclusionAI Ling 3.0 Flash VL — medical/multimodal reasoning and visual agent capability.
5. Nex N2.5 Pro — agentic reasoning, tools, coding and image input.
6. MiniMax M2.7 — agentic reasoning, coding and document workflows.
7. NVIDIA Nemotron 3.5 Lightning — fast agentic/reasoning workload.
8. Thinking Machines Inkling Small — efficient multimodal reasoning, RAG, multilingual and agentic workloads.

## Important current-model correction

DeepSeek V4 Flash and GLM 5.3 Flash were investigated as candidates, but the current OpenRouter pages checked during this implementation show paid variants rather than free variants. They are therefore **not added to the free-only ClinAI pool**. Re-check their pricing before a future free endpoint is enabled.

## Capability pools

- Multimodal/image/audio/video: Gemini, Inkling, MiniMax M3, Nex N2.5 Mini, Gemma 4 31B, Gemma 4 26B A4B, Nemotron 3 Nano Omni, Ling 3.0 Flash VL, Nex N2.5 Pro, Inkling Small.
- Medical: Ling 3.0 Flash Sante and Ling 3.0 Flash VL, with Gemini/general models available as fallbacks.
- Reasoning/research: Nemotron 3 Ultra/Super, Gemini, MiniMax, Gemma, Nex Pro, Inkling Small and other registered reasoning models.
- Agentic/tools: Nemotron, Inkling, MiniMax, Nex Pro, M2.7 and compatible existing models.
- Coding: Nex Pro/Mini, GPT-OSS 120B, MiniMax M2.7 and other registered coding models.
- Fast: models explicitly marked fast, plus the existing quick-path logic.

## Safety boundary

Free public endpoints remain subject to ClinAI's existing public-model patient-data policy. Patient data is redacted for public models unless the existing explicit policy allows otherwise. Deterministic CDSS remains the clinical safety authority. LLM output remains advisory and human-reviewed.

## Routing behavior

The router now accepts an optional `capability` value: `text`, `multimodal`, `image`, `audio`, `video`, `agentic`, `medical`, `coding`, `research`, or `fast`. Compatible models are ranked before fallback selection. The capability is included in the AI cache key to prevent a text response from being reused for a multimodal request.

## Source verification

OpenRouter's current free-model collection lists free endpoints and notes that free endpoints are rate-limited. Current pages specifically verify Gemma 4 31B/26B A4B, Nemotron 3 Nano Omni, Ling 3.0 Flash VL, Nex N2.5 Pro, MiniMax M2.7 and other free candidates.
