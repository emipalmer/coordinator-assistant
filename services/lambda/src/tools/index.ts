import { addVolunteer, findVolunteers, markPaperwork, paperworkStatus, updateVolunteer } from './volunteers.js';
import { assignVolunteers, cancelAssignment, cancelShift, createShift, listShifts, logAttendance, shiftCalendarFile, updateShift } from './shifts.js';
import { dailyCheck, suggestBackfill } from './proactive.js';
import { cancelForm, finishForm, impactReport, onboardingPacketTool, startForm, updateForm, updateSettings } from './forms.js';
import { savePreferences } from './coordinator.js';
import { hoursStats, makeChart } from './charts.js';
import { dashboardLink, revokeDashboardLinks } from './dashboard.js';
import { checkCalendar, connectGoogle, disconnectGoogle, draftEmail, googleStatus, syncShiftsToCalendar } from './google.js';
import type { Tool } from './registry.js';

export const ALL_TOOLS = [
  addVolunteer, updateVolunteer, findVolunteers, markPaperwork, paperworkStatus,
  createShift, listShifts, assignVolunteers, cancelAssignment, logAttendance, shiftCalendarFile, updateShift, cancelShift,
  dailyCheck, suggestBackfill,
  startForm, updateForm, finishForm, cancelForm, impactReport, onboardingPacketTool, updateSettings,
  savePreferences, hoursStats, makeChart, dashboardLink, revokeDashboardLinks,
  connectGoogle, googleStatus, disconnectGoogle, checkCalendar, syncShiftsToCalendar, draftEmail,
] as Tool[];
