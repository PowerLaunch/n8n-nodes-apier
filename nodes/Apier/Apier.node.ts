import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { apierApiRequest, CHANGE_SOURCES, getChanges, normaliseOrgNumber, toRfc3339, unwrap } from './GenericFunctions';

const sourceOptions = CHANGE_SOURCES.map((value) => ({
	name: {
		brreg: 'Brønnøysund Registers',
		norges_bank: 'Norges Bank',
		nav: 'NAV Aa-Registeret',
		skatteetaten: 'Skatteetaten',
	}[value],
	value,
}));

export class Apier implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Apier',
		name: 'apier',
		icon: 'file:apier.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Norwegian company signing authority, compliance summary and change history from the official registers',
		defaults: { name: 'Apier' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'apierApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Company', value: 'company' },
					{ name: 'Change', value: 'change' },
					{ name: 'Subscription', value: 'subscription' },
				],
				default: 'company',
			},

			// Company
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['company'] } },
				options: [
					{
						name: 'Get Authority',
						value: 'getAuthority',
						description:
							'Get who can sign for the company: the coded signing rules and prokura from the Brønnøysund Registers',
						action: 'Get company signing authority',
					},
					{
						name: 'Get Summary',
						value: 'getSummary',
						description: 'Get the company’s obligations and upcoming deadlines',
						action: 'Get company compliance summary',
					},
				],
				default: 'getAuthority',
			},
			{
				displayName: 'Organisation Number',
				name: 'orgNumber',
				type: 'string',
				required: true,
				default: '',
				placeholder: '999999999',
				description: 'The nine-digit Norwegian organisation number',
				displayOptions: { show: { resource: ['company'] } },
			},
			{
				displayName: 'Horizon (Months)',
				name: 'horizonMonths',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 24 },
				default: 12,
				description: 'How many months ahead to list deadlines',
				displayOptions: { show: { resource: ['company'], operation: ['getSummary'] } },
			},

			// Change
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['change'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List detected register changes, newest first',
						action: 'Get many changes',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { resource: ['change'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['change'], returnAll: [false] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['change'] } },
				options: [
					{ displayName: 'Source', name: 'source', type: 'options', options: sourceOptions, default: 'brreg' },
					{
						displayName: 'Organisation Number',
						name: 'entity_id',
						type: 'string',
						default: '',
						description:
							'Only changes for this organisation. Without it, changes to board members, signing rules and prokura are withheld.',
					},
					{
						displayName: 'Entity Type',
						name: 'entity_type',
						type: 'string',
						default: '',
						placeholder: 'company',
						description: 'For example company or annual_accounts for the Brønnøysund Registers',
					},
					{
						displayName: 'Change Type',
						name: 'change_type',
						type: 'options',
						options: [
							{ name: 'Created', value: 'created' },
							{ name: 'Updated', value: 'updated' },
							{ name: 'Deleted', value: 'deleted' },
						],
						default: 'updated',
					},
					{ displayName: 'From', name: 'from', type: 'dateTime', default: '' },
					{ displayName: 'To', name: 'to', type: 'dateTime', default: '' },
				],
			},

			// Subscription
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['subscription'] } },
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Send matching register changes to a webhook URL',
						action: 'Create a subscription',
					},
					{ name: 'Delete', value: 'delete', action: 'Delete a subscription' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many subscriptions' },
				],
				default: 'create',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/webhook',
				description: 'Public HTTPS address that receives the signed change events',
				displayOptions: { show: { resource: ['subscription'], operation: ['create'] } },
			},
			{
				displayName: 'Filter',
				name: 'filter',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				description: 'At least one field. A change is sent only when every field you set matches.',
				displayOptions: { show: { resource: ['subscription'], operation: ['create'] } },
				options: [
					{ displayName: 'Source', name: 'source', type: 'options', options: sourceOptions, default: 'brreg' },
					{ displayName: 'Organisation Number', name: 'entity_id', type: 'string', default: '' },
					{ displayName: 'Entity Type', name: 'entity_type', type: 'string', default: '', placeholder: 'company' },
					{
						displayName: 'Change Type',
						name: 'change_type',
						type: 'options',
						options: [
							{ name: 'Created', value: 'created' },
							{ name: 'Updated', value: 'updated' },
							{ name: 'Deleted', value: 'deleted' },
						],
						default: 'updated',
					},
				],
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['subscription'], operation: ['delete'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: IDataObject | IDataObject[];

				if (resource === 'company') {
					const org = normaliseOrgNumber(this, this.getNodeParameter('orgNumber', i) as string, i);
					if (operation === 'getAuthority') {
						result = unwrap(await apierApiRequest.call(this, 'GET', `/api/v1/company/${org}/authority`));
					} else {
						const horizon = this.getNodeParameter('horizonMonths', i) as number;
						result = unwrap(
							await apierApiRequest.call(this, 'GET', `/api/v1/company/${org}/summary`, undefined, {
								horizon_months: horizon,
							}),
						);
					}
				} else if (resource === 'change') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const max = returnAll ? Number.MAX_SAFE_INTEGER : (this.getNodeParameter('limit', i) as number);
					result = await getChanges.call(this, changeFilters(this, this.getNodeParameter('filters', i) as IDataObject, i), max);
				} else if (operation === 'create') {
					const filter = changeFilters(this, this.getNodeParameter('filter', i) as IDataObject, i);
					if (Object.keys(filter).length === 0) {
						throw new NodeOperationError(this.getNode(), 'Set at least one filter field', { itemIndex: i });
					}
					result = unwrap(
						await apierApiRequest.call(
							this,
							'POST',
							'/api/v1/subscriptions',
							{ webhook_url: this.getNodeParameter('webhookUrl', i) as string, filter },
							undefined,
							{ 'Idempotency-Key': idempotencyKey(this, i, operation) },
						),
					);
				} else if (operation === 'delete') {
					const id = encodeURIComponent(this.getNodeParameter('subscriptionId', i) as string);
					result = unwrap(
						await apierApiRequest.call(this, 'DELETE', `/api/v1/subscriptions/${id}`, undefined, undefined, {
							'Idempotency-Key': idempotencyKey(this, i, operation),
						}),
					);
				} else {
					// data is { data: SubscriptionRecord[] }: one output item per subscription
					const list = (await apierApiRequest.call(this, 'GET', '/api/v1/subscriptions')).data as IDataObject | undefined;
					result = Array.isArray(list?.data) ? (list?.data as IDataObject[]) : [];
				}

				const rows = Array.isArray(result) ? result : [result];
				out.push(...rows.map((json) => ({ json, pairedItem: { item: i } })));
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [out];
	}
}

/** Stable across n8n's Retry On Fail, which runs execute() again within the same execution,
 *  so a retried create after a timeout replays the stored answer instead of making a second subscription. */
function idempotencyKey(ctx: IExecuteFunctions, itemIndex: number, operation: string): string {
	return `n8n:${ctx.getExecutionId()}:${ctx.getNode().id}:${itemIndex}:${operation}`;
}

/** Drops empty fields, checks the organisation number and adds a timezone to picked dates,
 *  so the API never sees an empty or offset-less filter value. */
function changeFilters(ctx: IExecuteFunctions, raw: IDataObject, itemIndex: number): IDataObject {
	const filters: IDataObject = {};
	for (const [key, value] of Object.entries(raw)) {
		if (value === '' || value === undefined || value === null) continue;
		if (key === 'entity_id') filters[key] = normaliseOrgNumber(ctx, String(value), itemIndex);
		else if (key === 'from' || key === 'to') filters[key] = toRfc3339(String(value), ctx.getTimezone());
		else filters[key] = value;
	}
	return filters;
}
