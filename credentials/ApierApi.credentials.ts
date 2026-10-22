import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ApierApi implements ICredentialType {
	name = 'apierApi';

	displayName = 'Apier API';

	documentationUrl = 'https://www.apier.no/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Apier API key. Create one at https://www.apier.no/sign-up.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://www.apier.no',
			description: 'Leave as is unless Apier support gives you another address',
		},
	];

	// The key goes in the Authorization header only, never in a query string.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /api/v1/changes needs a key with read:changes (the default read:* scope covers it),
	// so a wrong or revoked key fails here with 401 instead of on the first workflow run.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/v1/changes',
			qs: { limit: 1 },
		},
	};
}
