import { describe, expect, it } from 'vitest';

import { advanceCursor, newRowsSince } from '../nodes/Apier/ApierTrigger.node';
import { readChangesPage, unwrap } from '../nodes/Apier/GenericFunctions';

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
		{ id: '3', detected_at: '2026-10-22T10:00:00Z' },
		{ id: '2', detected_at: '2026-10-22T10:00:00Z' },
		{ id: '1', detected_at: '2026-10-22T09:00:00Z' },
	];

	it('moves to the newest detected_at and remembers every id at that instant', () => {
		expect(advanceCursor(rows, '2026-10-22T08:00:00Z')).toEqual({
			lastDetectedAt: '2026-10-22T10:00:00Z',
			lastIds: ['3', '2'],
		});
	});

	it('keeps the previous time when nothing new arrived', () => {
		expect(advanceCursor([], '2026-10-22T08:00:00Z')).toEqual({ lastDetectedAt: '2026-10-22T08:00:00Z', lastIds: [] });
	});

	it('does not emit a row again when the inclusive from bound returns it a second time', () => {
		expect(newRowsSince(rows, ['3', '2']).map((row) => row.id)).toEqual(['1']);
	});
});
