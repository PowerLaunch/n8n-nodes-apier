# n8n-nodes-apier

An [n8n](https://n8n.io) community node for [Apier](https://www.apier.no). It lets a workflow check who can sign for a Norwegian company and react when a register changes, with the source and date on every answer.

## Nodes

**Apier**

| Resource | Operation | API call |
|---|---|---|
| Company | Get Authority: the coded signing rules and prokura, as the Brønnøysund Registers hold them | `GET /api/v1/company/{org}/authority` |
| Company | Get Summary: obligations and upcoming deadlines | `GET /api/v1/company/{org}/summary` |
| Change | Get Many: detected register changes, newest first | `GET /api/v1/changes` |
| Subscription | Create, Get Many, Delete: send matching changes to a webhook | `/api/v1/subscriptions` |

Every company answer keeps Apier's `_meta` block (rulebook version, data freshness, source), so a later step can show where the answer came from.

**Apier Trigger** polls `GET /api/v1/changes` and starts the workflow for each new change from one source, optionally for one organisation or one entity type (for example `annual_accounts` for new annual accounts filings). When it is first turned on it starts from that moment and does not replay older changes. A poll reads at most 5,000 changes; if more than that can arrive between two polls, filter by organisation or entity type.

Without an organisation number, changes to board members, signing rules and prokura are withheld by the API. Set an organisation number to receive them.

Sources: Brønnøysund Registers, Norges Bank, NAV Aa-registeret and Skatteetaten. Altinn and DigDir sources are not offered: their data is not licensed for commercial reuse.

## Credentials

Create an API key at <https://www.apier.no/sign-up> and add it as an **Apier API** credential. The key is sent in the `Authorization: Bearer` header only. Company lookups need the `read:brreg` scope, the change history needs `read:changes` (the default `read:*` key covers both), and subscriptions need `subscribe:webhooks`.

## Install

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-apier`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

No lockfile is committed yet; the devDependencies are pinned to exact versions.

## Licence

MIT
