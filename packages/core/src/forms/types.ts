// A form is data: adding a form means adding a FormTemplate, not code.

export type FieldType = 'text' | 'longtext' | 'date' | 'time' | 'enum' | 'boolean' | 'number' | 'phone';

/** Where a field's value can come from before anyone is asked. */
export type Prefill = 'volunteer.name' | 'volunteer.phone' | 'volunteer.email' | 'volunteer.isMinor' | 'org.name' | 'today' | 'coordinator.name';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** Short question texted to the coordinator when the value is missing. */
  ask: string;
  required?: boolean;
  /** Required only when another field has a given value (e.g. injury details only for injuries). */
  requiredWhen?: { field: string; equals: string | boolean };
  options?: readonly string[];
  prefill?: Prefill;
  section?: string;
}

export interface FormTemplate {
  id: string;
  title: string;
  description: string;
  /** Who fills the values in: coordinator over text, or a volunteer on paper (packet). */
  filledBy: 'coordinator' | 'volunteer';
  /** Whether the form is about a specific volunteer (enables volunteer.* prefills). */
  subject: 'volunteer' | 'none';
  fields: readonly FieldDef[];
  /** Static paragraphs printed on the PDF (policy text, signature lines). */
  boilerplate?: readonly { heading: string; body: string }[];
  signatures?: readonly string[];
}

export type FieldValue = string | number | boolean;
export type FormValues = Record<string, FieldValue>;
