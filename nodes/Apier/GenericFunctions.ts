import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

type ApierContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

/** Sources whose change history a workflow may read. Altinn and DigDir are left out:
 *  their data is not licensed for commercial reuse and their ingest jobs are retired. */
export const CHANGE_SOURCES = ['brreg', 'norges_bank', 'nav', 'skatteetaten'] as const;

const ORG_NUMBER = /^\d{9}$/;

/** Accepts "999 999 999" or "999999999"; throws on anything that is not nine digits. */
export function normaliseOrgNumber(ctx: ApierContext, raw: string, itemIndex?: number): string {
	const org = raw.replace(/\s+/g, '');
	if (!ORG_NUMBER.test(org)) {
		throw new NodeOperationError(ctx.getNode(), `"${raw}" is not a Norwegian organisation number`, {
			description: 'An organisation number is exactly nine digits, for example 999999999.',
			itemIndex,
		});
	}
	return org;
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Offset of `timeZone` from UTC, in milliseconds, at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(utcMs));
	const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
	return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** /api/v1/changes rejects a time without a timezone. n8n's date picker gives a wall-clock time
 *  ("2026-10-22T10:00:00"), which is read in the workflow's timezone and sent as UTC. */
export function toRfc3339(value: string, timeZone: string): string {
	if (HAS_OFFSET.test(value)) return value;
	const wallAsUtc = Date.parse(`${value}Z`);
	if (Number.isNaN(wallAsUtc)) return value; // left for the API to reject with VALIDATION_FAILED
	const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
	return new Date(wallAsUtc - zoneOffsetMs(first, timeZone)).toISOString(); // second pass settles DST edges
}

export async function apierApiRequest(
	this: ApierContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	headers?: Record<string, string>,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('apierApi');
	const baseUrl = String(credentials.baseUrl ?? 'https://www.apier.no').replace(/\/+$/, '');
	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		qs,
		headers: { Accept: 'application/json', ...headers },
		json: true,
	};
	if (body !== undefined) options.body = body;
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'apierApi', options)) as IDataObject;
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** Apier wraps every success as { success, data, _meta }; this returns `data` and keeps `_meta`
 *  beside it so a workflow can show the source and freshness of each answer. */
export function unwrap(response: IDataObject): IDataObject {
	const data = (response.data ?? {}) as IDataObject;
	return response._meta === undefined ? data : { ...data, _meta: response._meta };
}

export interface ChangesPage {
	rows: IDataObject[];
	nextCursor: string | null;
}

/** GET /api/v1/changes nests the rows: { data: { data: [...], pagination: { next_cursor } } }. */
export function readChangesPage(response: IDataObject): ChangesPage {
	const inner = (response.data ?? {}) as IDataObject;
	const rows = Array.isArray(inner.data) ? (inner.data as IDataObject[]) : [];
	const pagination = (inner.pagination ?? {}) as IDataObject;
	const next = pagination.next_cursor;
	return { rows, nextCursor: typeof next === 'string' && next !== '' ? next : null };
}

/** Reads every page of /api/v1/changes up to `max` rows. */
export async function getChanges(this: ApierContext, qs: IDataObject, max: number): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	let cursor: string | null = null;
	do {
		const pageQs: IDataObject = { ...qs, limit: Math.min(500, Math.max(1, max - rows.length)) };
		if (cursor !== null) pageQs.cursor = cursor;
		const page = readChangesPage(await apierApiRequest.call(this, 'GET', '/api/v1/changes', undefined, pageQs));
		rows.push(...page.rows);
		cursor = page.nextCursor;
	} while (cursor !== null && rows.length < max);
	return rows.slice(0, max);
}
