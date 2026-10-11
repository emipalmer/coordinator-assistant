import { addVolunteer, findVolunteers, markPaperwork, paperworkStatus, updateVolunteer } from './volunteers.js';
import { assignVolunteers, cancelAssignment, createShift, listShifts, logAttendance } from './shifts.js';
import type { Tool } from './registry.js';

export const ALL_TOOLS = [
  addVolunteer, updateVolunteer, findVolunteers, markPaperwork, paperworkStatus,
  createShift, listShifts, assignVolunteers, cancelAssignment, logAttendance,
] as Tool[];
