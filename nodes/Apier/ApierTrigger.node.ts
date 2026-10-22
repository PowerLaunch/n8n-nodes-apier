import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { CHANGE_SOURCES, getChanges, normaliseOrgNumber } from './GenericFunctions';

/** Most rows one poll reads. The API returns newest first, so when more than this arrive between two
 *  polls the oldest are not emitted; the README tells users to filter by organisation or entity type. */
const MAX_PER_POLL = 5000;

/** Each poll re-reads this far behind the cursor. `detected_at` is set when an insert starts, so a row
 *  can commit after a newer one was already read, and the n8n host clock can run ahead of Apier's.
 *  Ids already emitted inside the window are remembered and skipped. */
export const OVERLAP_MS = 5 * 60 * 1000;

export class ApierTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Apier Trigger',
		name: 'apierTrigger',
		icon: 'file:apier.svg',
		group: ['trigger'],
		version: 1,
		description: 'Starts the workflow when Apier detects a change in a Norwegian register',
		subtitle: '={{"Every change from " + $parameter["source"]}}',
		defaults: { name: 'Apier Trigger' },
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'apierApi', required: true }],
		properties: [
			{
				displayName: 'Source',
				name: 'source',
				type: 'options',
				options: CHANGE_SOURCES.map((value) => ({ name: value, value })),
				default: 'brreg',
			},
			{
				displayName: 'Organisation Number',
				name: 'orgNumber',
				type: 'string',
				default: '',
				placeholder: '999999999',
				description:
					'Watch one organisation. Leave empty to watch every organisation (changes to board members, signing rules and prokura are then withheld).',
			},
			{
				displayName: 'Entity Type',
				name: 'entityType',
				type: 'string',
				default: '',
				placeholder: 'company',
				description: 'For example company, or annual_accounts for new annual accounts filings',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const state = this.getWorkflowStaticData('node') as { lastDetectedAt?: string; lastIds?: string[] };
		const manual = this.getMode() === 'manual';

		const qs: IDataObject = { source: this.getNodeParameter('source') as string };
		const org = (this.getNodeParameter('orgNumber') as string).trim();
		if (org !== '') qs.entity_id = normaliseOrgNumber(this, org);
		const entityType = (this.getNodeParameter('entityType') as string).trim();
		if (entityType !== '') qs.entity_type = entityType;

		// Manual test: show the newest change and leave the saved cursor alone.
		if (manual) {
			const rows = await getChanges.call(this, qs, 1);
			return rows.length === 0 ? null : [this.helpers.returnJsonArray(rows)];
		}

		// First activation: mark everything already in the window as seen, so turning the trigger on
		// does not replay the archive.
		const firstRun = state.lastDetectedAt === undefined;
		const cursor = state.lastDetectedAt ?? new Date().toISOString();
		qs.from = windowStart(cursor);

		const rows = await getChanges.call(this, qs, MAX_PER_POLL);
		const fresh = firstRun ? [] : newRowsSince(rows, state.lastIds ?? []);
		const advanced = advanceCursor(rows, cursor);
		state.lastDetectedAt = advanced.lastDetectedAt;
		state.lastIds = advanced.lastIds;

		return fresh.length === 0 ? null : [this.helpers.returnJsonArray(fresh.reverse())];
	}
}

export function windowStart(cursor: string): string {
	return new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
}

/** Skips rows already emitted; the query window overlaps the previous one on purpose. */
export function newRowsSince(rows: IDataObject[], seenIds: string[]): IDataObject[] {
	const seen = new Set(seenIds);
	return rows.filter((row) => !seen.has(String(row.id)));
}

/** Rows arrive newest first. The cursor moves to the newest detected_at (never backwards), and every id
 *  inside the overlap window behind it is remembered, because the next query reads that window again. */
export function advanceCursor(
	rows: IDataObject[],
	previous: string,
): { lastDetectedAt: string; lastIds: string[] } {
	const newest = rows.length > 0 && Date.parse(String(rows[0].detected_at)) > Date.parse(previous)
		? String(rows[0].detected_at)
		: previous;
	const floor = Date.parse(newest) - OVERLAP_MS;
	return {
		lastDetectedAt: newest,
		lastIds: rows.filter((row) => Date.parse(String(row.detected_at)) >= floor).map((row) => String(row.id)),
	};
}
