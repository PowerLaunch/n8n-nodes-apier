import type { IDataObject, INodeExecutionData, INodeType, INodeTypeDescription, IPollFunctions } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { CHANGE_SOURCES, getChanges, normaliseOrgNumber } from './GenericFunctions';

/** Most rows one poll reads. The API returns newest first, so when more than this arrive between two
 *  polls the oldest are not emitted; the README tells users to filter by organisation or entity type. */
const MAX_PER_POLL = 5000;

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
		const now = new Date().toISOString();

		// First activation: start from now, so turning the trigger on does not replay the archive.
		if (state.lastDetectedAt === undefined && this.getMode() !== 'manual') {
			state.lastDetectedAt = now;
			state.lastIds = [];
			return null;
		}

		const qs: IDataObject = { source: this.getNodeParameter('source') as string };
		const org = (this.getNodeParameter('orgNumber') as string).trim();
		if (org !== '') qs.entity_id = normaliseOrgNumber(this, org);
		const entityType = (this.getNodeParameter('entityType') as string).trim();
		if (entityType !== '') qs.entity_type = entityType;
		if (state.lastDetectedAt !== undefined) qs.from = state.lastDetectedAt;

		const max = this.getMode() === 'manual' ? 1 : MAX_PER_POLL;
		const rows = await getChanges.call(this, qs, max);
		const fresh = newRowsSince(rows, state.lastIds ?? []);

		if (this.getMode() === 'manual') {
			return rows.length === 0 ? null : [this.helpers.returnJsonArray(rows)];
		}

		const advanced = advanceCursor(rows, state.lastDetectedAt ?? now);
		state.lastDetectedAt = advanced.lastDetectedAt;
		state.lastIds = advanced.lastIds;

		return fresh.length === 0 ? null : [this.helpers.returnJsonArray(fresh.reverse())];
	}
}

/** `from` is inclusive, so rows at exactly the last seen time come back; skip the ones already emitted. */
export function newRowsSince(rows: IDataObject[], seenIds: string[]): IDataObject[] {
	const seen = new Set(seenIds);
	return rows.filter((row) => !seen.has(String(row.id)));
}

/** Rows arrive newest first. The cursor moves to the newest detected_at, and remembers every id at that instant. */
export function advanceCursor(
	rows: IDataObject[],
	previous: string,
): { lastDetectedAt: string; lastIds: string[] } {
	if (rows.length === 0) return { lastDetectedAt: previous, lastIds: [] };
	const newest = String(rows[0].detected_at);
	return {
		lastDetectedAt: newest,
		lastIds: rows.filter((row) => String(row.detected_at) === newest).map((row) => String(row.id)),
	};
}
