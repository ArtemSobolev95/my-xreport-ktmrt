export type FieldType = 
  'header' | 'text' | 'number' | 'checkbox' | 'select' | 
  'rating' | 'notes' | 'formula' ;

export interface QuickButtonGroup {
  id: string;
  label: string;
  isExpanded: boolean;
  phrases: string[];
}

export interface BuilderField {
  id: string;
  type: FieldType;

  label?: string;
  placeholder?: string;
  defaultValue?: any;
  unit?: string;

  required?: boolean;
  options?: string[];

  max?: number;
  checkedPhrase?: string;
  uncheckedPhrase?: string;
  explanations?: string[];
  showExplanations?: boolean;

  notes?: string;
  formula?: string;
  variables?: Array<{ name: string; value: string }>;
  items?: any[];                   

  quickButtons?: QuickButtonGroup[];   // ← теперь строго типизировано
  isQuickText?: boolean;
}

export interface Template {
  id: string;
  title: string;
  fields: BuilderField[];
  user: string;
  isPublic: boolean;
  is_favorite?: boolean;
  created: string;
  updated?: string;
}

// Форма записи, которую реально возвращает список шаблонов (index.tsx) —
// запрос там намеренно не включает тяжёлое поле fields (см. getFullList
// с параметром fields в pages/index.tsx).
export type TemplateListItem = Pick<Template, 'id' | 'title' | 'user' | 'isPublic' | 'is_favorite' | 'created'>;