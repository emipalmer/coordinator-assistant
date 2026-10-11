import type { FormTemplate } from './types.js';

export const incidentReport: FormTemplate = {
  id: 'incident_report',
  title: 'Incident / Injury Report',
  description: 'Record an injury, near miss, or property damage that happened during volunteer activity.',
  filledBy: 'coordinator',
  subject: 'volunteer',
  fields: [
    { key: 'incidentDate', label: 'Date of incident', type: 'date', required: true, ask: 'What date did it happen?', section: 'What happened' },
    { key: 'incidentTime', label: 'Approximate time', type: 'time', required: true, ask: 'About what time?', section: 'What happened' },
    { key: 'location', label: 'Location', type: 'text', required: true, ask: 'Where did it happen (e.g. loading dock, main hall)?', section: 'What happened' },
    { key: 'incidentType', label: 'Type of incident', type: 'enum', options: ['injury', 'near miss', 'property damage', 'other'], required: true, ask: 'Was it an injury, near miss, property damage, or something else?', section: 'What happened' },
    { key: 'description', label: 'Description', type: 'longtext', required: true, ask: 'Briefly, what happened?', section: 'What happened' },
    { key: 'personName', label: 'Person involved', type: 'text', required: true, prefill: 'volunteer.name', ask: 'Who was involved?', section: 'Person involved' },
    { key: 'personRole', label: 'Role', type: 'enum', options: ['volunteer', 'client', 'staff', 'visitor'], required: true, ask: 'Were they a volunteer, client, staff, or visitor?', section: 'Person involved' },
    { key: 'injuryDescription', label: 'Nature of injury', type: 'longtext', requiredWhen: { field: 'incidentType', equals: 'injury' }, ask: 'What was the injury (e.g. cut on left hand)?', section: 'Injury' },
    { key: 'firstAidGiven', label: 'First aid given', type: 'boolean', requiredWhen: { field: 'incidentType', equals: 'injury' }, ask: 'Was first aid given?', section: 'Injury' },
    { key: 'firstAidDetails', label: 'First aid details / given by', type: 'text', requiredWhen: { field: 'firstAidGiven', equals: true }, ask: 'What first aid, and who gave it?', section: 'Injury' },
    { key: 'medicalTreatment', label: 'Further medical treatment', type: 'enum', options: ['none', 'urgent care', 'emergency room', '911 called'], requiredWhen: { field: 'incidentType', equals: 'injury' }, ask: 'Any further treatment: none, urgent care, ER, or 911?', section: 'Injury' },
    { key: 'witnesses', label: 'Witnesses', type: 'text', ask: 'Any witnesses?', section: 'Follow-up' },
    { key: 'actionsTaken', label: 'Actions taken / follow-up', type: 'longtext', required: true, ask: 'What was done afterward, or what follow-up is planned?', section: 'Follow-up' },
    { key: 'reportedBy', label: 'Reported by', type: 'text', required: true, prefill: 'coordinator.name', ask: 'Your name for the "reported by" line?', section: 'Follow-up' },
    { key: 'reportDate', label: 'Date of report', type: 'date', required: true, prefill: 'today', ask: 'Date of this report?', section: 'Follow-up' },
  ],
  signatures: ['Reporter signature', 'Supervisor signature'],
};

export const onboardingPacket: FormTemplate = {
  id: 'onboarding_packet',
  title: 'Volunteer Onboarding Packet',
  description: 'Application, emergency contact, waiver, code of conduct, and guardian consent (minors) for a volunteer to fill and sign.',
  filledBy: 'volunteer',
  subject: 'volunteer',
  fields: [
    { key: 'name', label: 'Full name', type: 'text', required: true, prefill: 'volunteer.name', ask: 'Name?', section: 'Volunteer application' },
    { key: 'phone', label: 'Phone', type: 'phone', prefill: 'volunteer.phone', ask: 'Phone?', section: 'Volunteer application' },
    { key: 'email', label: 'Email', type: 'text', prefill: 'volunteer.email', ask: 'Email?', section: 'Volunteer application' },
    { key: 'interests', label: 'Areas of interest', type: 'text', ask: 'Interests?', section: 'Volunteer application' },
    { key: 'emergencyName', label: 'Emergency contact name', type: 'text', ask: 'Emergency contact?', section: 'Emergency contact' },
    { key: 'emergencyRelationship', label: 'Relationship', type: 'text', ask: 'Relationship?', section: 'Emergency contact' },
    { key: 'emergencyPhone', label: 'Emergency contact phone', type: 'phone', ask: 'Emergency phone?', section: 'Emergency contact' },
  ],
  boilerplate: [
    {
      heading: 'Release and Waiver',
      body: 'I am volunteering of my own free will. I understand that volunteer activities may involve lifting, standing, and handling food, and I agree to follow safety instructions. I release the organization, its staff, and volunteers from liability for ordinary injuries arising from my volunteer activities, except those caused by gross negligence. I consent to emergency first aid if needed.',
    },
    {
      heading: 'Code of Conduct',
      body: 'I will treat clients, staff, and fellow volunteers with dignity and respect; keep client information confidential; follow food-safety and safety rules; not work under the influence of alcohol or drugs; and report any incident or concern to the volunteer coordinator.',
    },
  ],
  signatures: ['Volunteer signature'],
};

/** Extra page only for minors. */
export const guardianConsent = {
  heading: 'Parent / Guardian Consent (volunteers under 18)',
  body: 'I am the parent or legal guardian of the volunteer named above. I consent to their participation in volunteer activities, have reviewed the waiver and code of conduct with them, and consent to emergency first aid if needed.',
  signatures: ['Parent/guardian name', 'Parent/guardian signature', 'Parent/guardian phone'],
};

/** Registry: adding a coordinator-filled form = adding a template here. */
export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  [incidentReport.id]: incidentReport,
  [onboardingPacket.id]: onboardingPacket,
};
