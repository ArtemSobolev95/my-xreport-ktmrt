export type FieldType = 'header' | 'text' | 'number' | 'checkbox' | 'select' | 'rating' | 'notes' | 'formula';

export interface BuilderField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: string[];
  unit?: string;
  max?: number;
  checkedPhrase?: string;
  uncheckedPhrase?: string;
  explanations?: string[];
  showExplanations?: boolean;
  notes?: string;
  formula?: string;
  variables?: { name: string; value: string }[];
}
