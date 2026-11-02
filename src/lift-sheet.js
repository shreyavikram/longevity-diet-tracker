// Lift sends each workout to a Google Sheet that she published to the web as CSV (her request, 2026-10-27; a
// claude.ai page cannot reach GitHub, but it can use her Google Sheets connector). Lift only ever appends: every
// save or delete adds a row, and the newest row for a workout id wins.

export const LIFT_SHEET_COLUMNS = Object.freeze(['workoutId', 'updatedAt', 'deleted', 'startedAt', 'endedAt', 'name', 'entries']);

// RFC 4180: quoted fields may hold commas, line breaks, and doubled quotes. Google ends rows with CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const validTime = value => value !== '' && Number.isFinite(Date.parse(value));

export function parseLiftSheet(text) {
  const [head, ...rows] = parseCsv(String(text ?? '').replace(/^﻿/, ''));
  if (!head || head.join(',') !== LIFT_SHEET_COLUMNS.join(',')) return null;
  const newest = new Map();
  let skipped = 0;
  for (const [id, updated, deleted, startedAt, endedAt, name, entries] of rows) {
    const updatedAt = Number(updated);
    let workout = null;
    try {
      if (!id || updated === '' || !Number.isFinite(updatedAt)) throw new Error('No workout id or update time');
      if (deleted !== 'TRUE') {
        const parsed = JSON.parse(entries);
        if (!validTime(startedAt) || (endedAt !== '' && !validTime(endedAt)) || !Array.isArray(parsed)) throw new Error('Unreadable workout');
        workout = { id, updatedAt, startedAt, endedAt: endedAt === '' ? null : endedAt, name: name || 'Workout', entries: parsed };
      }
    } catch {
      skipped += 1;
      continue;
    }
    if (!newest.has(id) || newest.get(id).updatedAt < updatedAt) newest.set(id, { updatedAt, workout });
  }
  const workouts = {};
  for (const [id, { workout }] of newest) if (workout) workouts[id] = workout;
  return { workouts, skipped };
}
