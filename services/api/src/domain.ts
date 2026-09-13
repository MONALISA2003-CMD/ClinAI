export const MODULES = [
  'identity','organizations','patients','appointments','queues','triage','encounters','clinical','orders',
  'laboratory','pharmacy','medications','inventory','procurement','imaging','procedures','referrals',
  'emergency','inpatient','beds','nursing','surgery','maternity','pediatrics','immunization','chronic-care',
  'billing','payments','insurance','accounting','notifications','communication','documents','consent',
  'ai','interoperability','analytics','audit','settings'
] as const;

export const ORDER_STATUSES = ['draft','ordered','accepted','in-progress','completed','verified','cancelled','rejected'] as const;
export const QUEUE_STATUSES = ['waiting','called','in-service','completed','cancelled','no-show'] as const;
export const ENCOUNTER_STATUSES = ['planned','in-progress','completed','cancelled'] as const;
