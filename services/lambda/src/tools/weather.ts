import { z } from 'zod';
import { addDays, DEFAULT_WEATHER_PLACE, localDate } from '@app/core';
import { defineTool, type ToolContext } from './registry.js';

// Open-Meteo: free, no API key. Only a place name or coordinates are sent.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska',
  NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** WMO weather codes to plain words. */
function describe(code: number): string {
  if (code === 0) return 'clear';
  if (code === 1) return 'mostly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 55) return 'drizzle';
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'freezing rain';
  if (code >= 61 && code <= 65) return code === 65 ? 'heavy rain' : 'rain';
  if (code >= 71 && code <= 77) return code === 75 ? 'heavy snow' : 'snow';
  if (code >= 80 && code <= 82) return 'showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'thunderstorms';
  return 'mixed';
}

interface Place { name: string; lat: number; lon: number; label: string }
const geoCache = new Map<string, Place>([[DEFAULT_WEATHER_PLACE.toLowerCase(), { name: 'State College', lat: 40.7934, lon: -77.86, label: 'State College, Pennsylvania' }]]);

async function geocode(query: string): Promise<Place | undefined> {
  const key = query.trim().toLowerCase();
  const hit = geoCache.get(key);
  if (hit) return hit;
  const [city, region] = query.split(',').map((s) => s.trim());
  const q = new URLSearchParams({ name: city!, count: '10', language: 'en', format: 'json' });
  const res = await fetch(`${GEO}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`geocoding failed (${res.status})`);
  const results = ((await res.json()) as { results?: Array<{ name: string; latitude: number; longitude: number; admin1?: string; country?: string; country_code?: string }> }).results ?? [];
  const want = region ? (STATES[region.toUpperCase()] ?? region).toLowerCase() : undefined;
  const r =
    (want && results.find((x) => x.admin1?.toLowerCase() === want || x.country?.toLowerCase() === want || x.country_code?.toLowerCase() === want)) ||
    results.find((x) => x.country_code === 'US') ||
    results[0];
  if (!r) return undefined;
  const place = { name: r.name, lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1, r.country_code === 'US' ? undefined : r.country].filter(Boolean).join(', ') };
  geoCache.set(key, place);
  return place;
}

async function forecast(place: Place, from: string, to: string, ctx: ToolContext) {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,apparent_temperature,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    hourly: 'precipitation_probability,temperature_2m',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: ctx.timezone,
    start_date: from,
    end_date: to,
  });
  const res = await fetch(`${FORECAST}?${q}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`forecast failed (${res.status})`);
  return (await res.json()) as {
    current?: { temperature_2m: number; apparent_temperature: number; weather_code: number };
    daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; wind_speed_10m_max: number[] };
    hourly: { time: string[]; precipitation_probability: (number | null)[]; temperature_2m: number[] };
  };
}

/** "rain likely 3pm-7pm" style windows from hourly precipitation probability (>= 50%). */
function wetWindows(day: string, hourly: { time: string[]; precipitation_probability: (number | null)[] }): string[] {
  const hours = hourly.time.map((t, i) => ({ t, p: hourly.precipitation_probability[i] ?? 0 })).filter((h) => h.t.startsWith(day));
  const out: string[] = [];
  let start: string | undefined;
  const label = (t: string) => {
    const h = +t.slice(11, 13);
    return h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
  };
  hours.forEach((h, i) => {
    if (h.p >= 50 && !start) start = h.t;
    if ((h.p < 50 || i === hours.length - 1) && start) {
      out.push(`${label(start)}-${label(h.p < 50 ? h.t : `${day}T23`)}`);
      start = undefined;
    }
  });
  return out;
}

export const getWeather = defineTool({
  name: 'get_weather',
  description:
    'Weather forecast (°F) for up to 7 days within the next 2 weeks: conditions, high/low, chance of rain, wind, and when rain is likely each day; plus current conditions when the range includes today. Defaults to the owner\'s saved place (State College, PA unless they changed it) and today.',
  input: z.object({
    place: z.string().min(2).max(100).optional().describe('City, e.g. "Philadelphia, PA". Omit for their usual place.'),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  async run(ctx, input) {
    const profile = await ctx.c.profiles.findOne({ _id: ctx.owner }, { projection: { prefs: 1 } });
    const query = input.place ?? profile?.prefs?.weatherPlace ?? DEFAULT_WEATHER_PLACE;
    const today = localDate(ctx.now, ctx.timezone);
    const from = input.from && input.from > today ? input.from : today;
    const last = addDays(today, 15);
    let to = input.to ?? from;
    if (to < from) to = from;
    if (to > addDays(from, 6)) to = addDays(from, 6);
    if (from > last) return { ok: false, content: 'Forecasts only go about 2 weeks out.' };
    if (to > last) to = last;
    const place = await geocode(query);
    if (!place) return { ok: false, content: `Couldn't find a place called "${query}".` };
    const f = await forecast(place, from, to, ctx);
    const days = f.daily.time.map((day, i) => ({
      day,
      conditions: describe(f.daily.weather_code[i]!),
      high: Math.round(f.daily.temperature_2m_max[i]!),
      low: Math.round(f.daily.temperature_2m_min[i]!),
      rainChance: f.daily.precipitation_probability_max[i] ?? undefined,
      windMph: Math.round(f.daily.wind_speed_10m_max[i]!),
      ...(wetWindows(day, f.hourly).length && { wetHours: wetWindows(day, f.hourly) }),
    }));
    return {
      ok: true,
      content: JSON.stringify({
        place: place.label,
        ...(from === today && f.current && { now: { temp: Math.round(f.current.temperature_2m), feelsLike: Math.round(f.current.apparent_temperature), conditions: describe(f.current.weather_code) } }),
        days,
      }),
    };
  },
});
