export type FieldType = 
  'header' | 'text' | 'number' | 'checkbox' | 'select' | 
  'rating' | 'notes' | 'formula' | 'comparison';

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
  quickButtons?: any[];
  isQuickText?: boolean;
}
