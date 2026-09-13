export type ClinAILanguage = 'English' | 'Kiswahili' | 'Kinyarwanda' | 'Luganda' | 'Runyankore' | 'Alur';

export type LanguagePolicy = {
  language: ClinAILanguage; code: string;
  tier: 'full' | 'strong-controlled' | 'limited-supervised' | 'very-limited' | 'translation-only';
  clinicalNlp: boolean; clinicalReasoning: boolean; translation: boolean;
  requireClarificationOnLowConfidence: boolean; maxResponseRisk: 'normal' | 'controlled' | 'conservative';
};

const POLICIES: Record<ClinAILanguage, LanguagePolicy> = {
  English: { language: 'English', code: 'en', tier: 'full', clinicalNlp: true, clinicalReasoning: true, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'normal' },
  Kiswahili: { language: 'Kiswahili', code: 'sw', tier: 'strong-controlled', clinicalNlp: true, clinicalReasoning: true, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'controlled' },
  Kinyarwanda: { language: 'Kinyarwanda', code: 'rw', tier: 'strong-controlled', clinicalNlp: true, clinicalReasoning: true, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'controlled' },
  Luganda: { language: 'Luganda', code: 'lg', tier: 'limited-supervised', clinicalNlp: true, clinicalReasoning: false, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'conservative' },
  Runyankore: { language: 'Runyankore', code: 'nyn', tier: 'very-limited', clinicalNlp: true, clinicalReasoning: false, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'conservative' },
  Alur: { language: 'Alur', code: 'alz', tier: 'translation-only', clinicalNlp: false, clinicalReasoning: false, translation: true, requireClarificationOnLowConfidence: true, maxResponseRisk: 'conservative' },
};

export const SUPPORTED_CLINAI_LANGUAGES = Object.keys(POLICIES) as ClinAILanguage[];

export function getLanguagePolicy(value?: string | null): LanguagePolicy {
  const normalized = String(value || 'English').trim().toLowerCase();
  const aliases: Record<string, ClinAILanguage> = { en:'English', english:'English', sw:'Kiswahili', kiswahili:'Kiswahili', swahili:'Kiswahili', rw:'Kinyarwanda', kinyarwanda:'Kinyarwanda', lg:'Luganda', luganda:'Luganda', nyn:'Runyankore', runyankore:'Runyankore', 'runyankore-rukiga':'Runyankore', runyankole:'Runyankore', alz:'Alur', alur:'Alur' };
  return POLICIES[aliases[normalized] || 'English'];
}

export function languageInstruction(policy: LanguagePolicy, detected?: any): string {
  const detection = detected ? `Detected input: ${JSON.stringify(detected)}.` : '';
  const controls = policy.tier === 'full' ? 'Use the full ClinAI clinical-support capability available in this request.' : policy.tier === 'strong-controlled' ? 'Use broad clinical communication and reasoning, but remain conservative when terminology is ambiguous and explicitly surface uncertainty.' : policy.tier === 'limited-supervised' ? 'Use language understanding and translation only when meaning is sufficiently clear. Do not extend uncertain language interpretation into clinical conclusions; ask for clarification or preserve the original wording.' : policy.tier === 'very-limited' ? 'Keep responses conservative. Prefer clear translation/communication and record-linked facts. Do not make clinical inferences from uncertain language. Ask for confirmation when meaning is unclear.' : 'Use translation/communication support only. Do not perform clinical NLP or clinical reasoning from Alur text when meaning is uncertain; preserve the original wording and request human confirmation.';
  return `Response language: ${policy.language}. ${controls} ${detection} Never invent a translation. Preserve medication names, numbers, units, dates, warnings and clinical meaning. If confidence is insufficient, say so and ask the clinician to confirm. Never expose internal structured data.`;
}
