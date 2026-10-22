import { describe, expect, it } from 'vitest';

import { advanceCursor, newRowsSince, OVERLAP_MS, windowStart } from '../nodes/Apier/ApierTrigger.node';
import { readChangesPage, toRfc3339, unwrap } from '../nodes/Apier/GenericFunctions';

describe('readChangesPage', () => {
	it('reads the nested rows and the next cursor', () => {
		const page = readChangesPage({
			success: true,
			data: { data: [{ id: 'a' }], pagination: { next_cursor: 'c1', has_more: true } },
		});
		expect(page).toEqual({ rows: [{ id: 'a' }], nextCursor: 'c1' });
	});

	it('treats a null or missing cursor as the last page', () => {
		expect(readChangesPage({ data: { data: [], pagination: { next_cursor: null } } }).nextCursor).toBeNull();
		expect(readChangesPage({}).rows).toEqual([]);
	});
});

describe('unwrap', () => {
	it('returns data and keeps _meta beside it', () => {
		expect(unwrap({ success: true, data: { mode: 'sole' }, _meta: { rulebook_version: 'x' } })).toEqual({
			mode: 'sole',
			_meta: { rulebook_version: 'x' },
		});
	});
});

describe('trigger cursor', () => {
	const rows = [
		{ id: '4', detected_at: '2026-10-22T10:00:00Z' },
		{ id: '3', detected_at: '2026-10-22T10:00:00Z' },
		{ id: '2', detected_at: '2026-10-22T09:57:00Z' },
		{ id: '1', detected_at: '2026-10-22T09:00:00Z' },
	];

	it('moves to the newest detected_at and remembers every id inside the overlap window', () => {
		expect(advanceCursor(rows, '2026-10-22T08:00:00Z')).toEqual({
			lastDetectedAt: '2026-10-22T10:00:00Z',
			lastIds: ['4', '3', '2'],
		});
	});

	it('never moves the cursor backwards, and keeps it when nothing arrived', () => {
		expect(advanceCursor([], '2026-10-22T08:00:00Z')).toEqual({ lastDetectedAt: '2026-10-22T08:00:00Z', lastIds: [] });
		expect(advanceCursor([rows[3]], '2026-10-22T09:02:00Z').lastDetectedAt).toBe('2026-10-22T09:02:00Z');
	});

	it('reads the window again, so a late-committed row inside it is still emitted once', () => {
		expect(windowStart('2026-10-22T10:00:00Z')).toBe(new Date(Date.parse('2026-10-22T10:00:00Z') - OVERLAP_MS).toISOString());
		const late = { id: '5', detected_at: '2026-10-22T09:58:00Z' };
		expect(newRowsSince([rows[0], rows[1], late, rows[2]], ['4', '3', '2']).map((row) => row.id)).toEqual(['5']);
	});
});

describe('toRfc3339', () => {
	it('keeps a time that already has an offset', () => {
		expect(toRfc3339('2026-10-22T10:00:00+02:00', 'Europe/Oslo')).toBe('2026-10-22T10:00:00+02:00');
		expect(toRfc3339('2026-10-22T10:00:00Z', 'Europe/Oslo')).toBe('2026-10-22T10:00:00Z');
	});

	it('reads a picked wall-clock time in the workflow timezone, across the DST change', () => {
		expect(toRfc3339('2026-07-01T12:00:00', 'Europe/Oslo')).toBe('2026-07-01T10:00:00.000Z');
		expect(toRfc3339('2026-12-01T12:00:00', 'Europe/Oslo')).toBe('2026-12-01T11:00:00.000Z');
	});
});
