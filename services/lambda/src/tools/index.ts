import { PROFILE_TOOLS } from './profile.js';
import { GOOGLE_ACCOUNT_TOOLS } from './google.js';
import { CALENDAR_TOOLS } from './calendar.js';
import { GMAIL_TOOLS } from './gmail.js';
import { CANVAS_TOOLS } from './canvas.js';
import { REMINDER_TOOLS } from './reminders.js';
import { TASK_TOOLS } from './tasks.js';
import { getWeather } from './weather.js';
import { makeChart } from './charts.js';
import { CAPY_TOOLS } from './capys.js';
import type { Tool } from './registry.js';

export const ALL_TOOLS = [
  ...PROFILE_TOOLS,
  ...GOOGLE_ACCOUNT_TOOLS,
  ...CALENDAR_TOOLS,
  ...GMAIL_TOOLS,
  ...CANVAS_TOOLS,
  ...REMINDER_TOOLS,
  ...TASK_TOOLS,
  getWeather,
  makeChart,
  ...CAPY_TOOLS,
] as Tool[];
