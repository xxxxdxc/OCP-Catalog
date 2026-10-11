import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redactSavedProviderApiKey } from './provider-output';

const cliPath = path.resolve(import.meta.dir, 'index.ts');
const tmpRoot = path.join(tmpdir(), 'ocp-cli-help-test');

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function runCli(...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(import.meta.dir, '..', '..', '..'),
    encoding: 'utf8',
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function runCliRaw(...args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.resolve(import.meta.dir, '..', '..', '..'),
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ? JSON.parse(result.stdout) : undefined,
    stderr: result.stderr ? JSON.parse(result.stderr) : undefined,
  };
}

function writeManifestFile() {
  mkdirSync(tmpRoot, { recursive: true });
  const manifestPath = path.join(tmpRoot, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({
    ocp_version: '1.0',
    kind: 'CatalogManifest',
    id: 'manifest_1',
    catalog_id: 'cat_test',
    catalog_name: 'Test Catalog',
    endpoints: {
      query: { url: 'https://catalog.example.test/ocp/query', method: 'POST' },
      resolve: { url: 'https://catalog.example.test/ocp/resolve', method: 'POST' },
    },
    query_capabilities: [
      {
        capability_id: 'commerce.search',
        query_packs: [
          { pack_id: 'ocp.query.keyword.v1', query_modes: ['keyword', 'hybrid'], metadata: {} },
        ],
        searchable_field_refs: [],
        filterable_field_refs: [],
        sortable_field_refs: [],
        input_fields: [
          { name: 'filters.category', type: 'string' },
        ],
        supports_explain: true,
        supports_resolve: true,
        metadata: {},
      },
    ],
    object_contracts: [
      {
        required_fields: ['ocp.commerce.product.core.v1#/title'],
        optional_fields: [],
        additional_fields_policy: 'allow',
      },
    ],
  }));
  return manifestPath;
}

describe('CLI help', () => {
  test('prints package identity for version checks', () => {
    expect(runCli('--version')).toEqual({
      name: '@ocp-catalog/ocp-cli',
      version: '0.1.3',
    });

    expect(runCli('version')).toEqual({
      name: '@ocp-catalog/ocp-cli',
      version: '0.1.3',
    });
  });

  test('describes every command with intent, options, and examples', () => {
    const help = runCli('--help');

    expect(help.overview).toContain('OCP Catalog');
    expect(help.workflow).toEqual([
      'Discover a Registration node',
      'Search or resolve a Catalog route',
      'Inspect the Catalog manifest',
      'Register as a Provider when publishing objects',
      'Query with a manifest-declared query pack',
      'Resolve a selected entry when details or actions are needed',
    ]);

    expect(help.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'ocp version',
          summary: expect.stringContaining('package identity'),
          description: expect.stringContaining('structured JSON'),
        }),
        expect.objectContaining({
          command: 'ocp registration discover <discovery-url>',
          summary: expect.stringContaining('Registration'),
          description: expect.stringContaining('discovery document'),
          options: expect.arrayContaining([
            expect.objectContaining({
              name: '--timeout-ms',
              description: expect.stringContaining('request timeout'),
            }),
          ]),
          examples: expect.arrayContaining([
            expect.stringContaining('ocp registration discover'),
          ]),
        }),
        expect.objectContaining({
          command: 'ocp catalog query --query-url <url> [--query-pack <id>] [--query-mode <mode>] [--query <text>]',
          summary: expect.stringContaining('Search'),
          description: expect.stringContaining('manifest-declared query pack'),
          options: expect.arrayContaining([
            expect.objectContaining({
              name: '--filters',
              description: expect.stringContaining('JSON object'),
            }),
          ]),
        }),
        expect.objectContaining({
          command: 'ocp provider register --register-url <url> --input <provider-registration.json> [--save-api-key <file>]',
          summary: expect.stringContaining('Provider'),
          description: expect.stringContaining('provider_api_key'),
          options: expect.arrayContaining([
            expect.objectContaining({
              name: '--save-api-key',
              description: expect.stringContaining('provider_api_key'),
            }),
          ]),
        }),
        expect.objectContaining({
          command: 'ocp provider sync --sync-url <url> --input <object-sync-request.json> --api-key <provider-api-key>',
          summary: expect.stringContaining('sync'),
          description: expect.stringContaining('ObjectSyncRequest'),
        }),
        expect.objectContaining({
          command: 'ocp skill doctor [--target auto|codex|agents|claude|both|all|<skills-dir>]',
          summary: expect.stringContaining('Check'),
          description: expect.stringContaining('installed skill'),
        }),
        expect.objectContaining({
          command: 'ocp events tail --activity-url <url>',
          summary: expect.stringContaining('Read'),
          description: expect.stringContaining('public Activity API'),
        }),
      ]),
    );

    for (const command of help.commands) {
      expect(command.summary).toBeString();
      expect(command.description).toBeString();
      if (command.command !== 'ocp version') {
        expect(command.options.length).toBeGreaterThan(0);
      }
      expect(command.examples.length).toBeGreaterThan(0);
    }
  });

  test('returns focused help for domains and individual commands', () => {
    const registration = runCli('registration', '--help');

    expect(registration.domain).toBe('registration');
    expect(registration.description).toContain('do not search products');
    expect(registration.commands.map((command: { action?: string }) => command.action)).toEqual([
      'discover',
      'search',
      'resolve',
    ]);

    const catalogQuery = runCli('catalog', 'query', '--help');

    expect(catalogQuery.command).toBe('ocp catalog query --query-url <url> [--query-pack <id>] [--query-mode <mode>] [--query <text>]');
    expect(catalogQuery.description).toContain('manifest-declared query pack');
    expect(catalogQuery.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '--query-pack',
          description: expect.stringContaining('Optional'),
        }),
        expect.objectContaining({
          name: '--query-mode',
          description: expect.stringContaining('keyword'),
        }),
        expect.objectContaining({
          name: '--cursor',
          description: expect.stringContaining('next page'),
        }),
      ]),
    );

    const provider = runCli('provider', '--help');

    expect(provider.domain).toBe('provider');
    expect(provider.description).toContain('provider API key');
    expect(provider.commands.map((command: { action?: string }) => command.action)).toEqual([
      'register',
      'sync',
    ]);
  });

  test('treats help as a query option value during validation', () => {
    const manifestPath = writeManifestFile();
    const result = runCli('validate', 'query', '--manifest', manifestPath, '--query', 'help');
    expect(result).toMatchObject({ ok: true, request: { query: 'help' } });
    expect(result.command).toBeUndefined();
  });

  test('catalog query reaches manifest validation when the query is help', () => {
    const manifestPath = writeManifestFile();
    const result = runCliRaw(
      'catalog', 'query', '--manifest', manifestPath,
      '--query-url', 'https://catalog.example.test/ocp/query',
      '--query-pack', 'ocp.query.semantic.v1', '--query', 'help',
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatchObject({ error: {
      code: 'validation_error', details: { code: 'invalid_query_pack' },
    } });
    expect(result.stdout).toBeUndefined();
  });

  test('keeps explicit help commands and help flags working', () => {
    for (const args of [
      ['help', 'catalog', 'query'],
      ['catalog', 'query', 'help'],
      ['catalog', 'query', '--help'],
      ['catalog', 'query', '-h'],
      ['catalog', 'query', '--query', 'help', '--help'],
    ]) {
      expect(runCli(...args)).toMatchObject({ domain: 'catalog', action: 'query' });
    }
  });

  test('does not interpret a consumed short help token as an option', () => {
    const manifestPath = writeManifestFile();
    const result = runCli('validate', 'query', '--manifest', manifestPath, '--query', '-h');
    expect(result).toMatchObject({ ok: true, request: { query: '-h' } });
  });

  test('validates a query against a manifest before sending it', () => {
    const manifestPath = writeManifestFile();

    const success = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query',
      'running shoes',
      '--query-mode',
      'hybrid',
      '--filters',
      '{"category":"shoes"}',
      '--cursor',
      'next_page_cursor_1',
    );

    expect(success.status).toBe(0);
    expect(success.stdout).toMatchObject({
      ok: true,
      request: {
        query_pack: 'ocp.query.keyword.v1',
        query_mode: 'hybrid',
        cursor: 'next_page_cursor_1',
      },
      policy_summary: {
        selected_query_pack: 'ocp.query.keyword.v1',
        query_mode: 'hybrid',
        accepted_filters: ['category'],
      },
    });

    const failure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query-pack',
      'ocp.query.semantic.v1',
      '--filters',
      '{"brand":"Acme"}',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        message: expect.stringContaining('unsupported query_pack'),
        details: {
          code: 'invalid_query_pack',
          supported_query_packs: ['ocp.query.keyword.v1'],
        },
      },
    });
  });

  test('catalog query uses manifest validation before network send when manifest is provided', () => {
    const manifestPath = writeManifestFile();

    const failure = runCliRaw(
      'catalog',
      'query',
      '--manifest',
      manifestPath,
      '--query-url',
      'https://catalog.example.test/ocp/query',
      '--query-pack',
      'ocp.query.semantic.v1',
      '--query',
      'running shoes',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        message: expect.stringContaining('unsupported query_pack'),
        details: {
          code: 'invalid_query_pack',
          supported_query_packs: ['ocp.query.keyword.v1'],
        },
      },
    });
    expect(JSON.stringify(failure.stderr)).not.toContain('Failed to fetch');
  });

  test('catalog query validates explicit query mode before network send', () => {
    const manifestPath = writeManifestFile();

    const failure = runCliRaw(
      'catalog',
      'query',
      '--manifest',
      manifestPath,
      '--query-url',
      'https://catalog.example.test/ocp/query',
      '--query-pack',
      'ocp.query.keyword.v1',
      '--query-mode',
      'semantic',
      '--query',
      'running shoes',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        message: expect.stringContaining('does not support query mode semantic'),
        details: {
          code: 'invalid_query_mode',
          query_pack: 'ocp.query.keyword.v1',
          query_mode: 'semantic',
          supported_query_modes: ['keyword', 'hybrid'],
        },
      },
    });
    expect(JSON.stringify(failure.stderr)).not.toContain('Failed to fetch');
  });

  test('catalog query rejects a query URL that does not match the provided manifest', () => {
    const manifestPath = writeManifestFile();

    const failure = runCliRaw(
      'catalog',
      'query',
      '--manifest',
      manifestPath,
      '--query-url',
      'https://other.example.test/ocp/query',
      '--query',
      'running shoes',
      '--filters',
      '{"category":"shoes"}',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'invalid_query_endpoint',
          received_query_url: 'https://other.example.test/ocp/query',
          manifest_query_url: 'https://catalog.example.test/ocp/query',
        },
      },
    });
  });

  test('normalizes protocol schema errors as validation feedback', () => {
    const manifestPath = writeManifestFile();

    const limitFailure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--query',
      'running shoes',
      '--limit',
      '0',
    );

    expect(limitFailure.status).toBe(1);
    expect(limitFailure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'protocol_schema_error',
          correction: expect.stringContaining('protocol schema'),
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'limit',
              message: expect.any(String),
            }),
          ]),
        },
      },
    });

    const filterFailure = runCliRaw(
      'validate',
      'query',
      '--manifest',
      manifestPath,
      '--filters',
      '{"color":"blue"}',
    );

    expect(filterFailure.status).toBe(1);
    expect(filterFailure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'protocol_schema_error',
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'filters',
              code: 'unrecognized_keys',
            }),
          ]),
        },
      },
    });
  });

  test('provider sync validates ObjectSyncRequest before network send', () => {
    mkdirSync(tmpRoot, { recursive: true });
    const syncPath = path.join(tmpRoot, 'bad-sync.json');
    writeFileSync(syncPath, JSON.stringify({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: 'cat_test',
      provider_id: 'provider_test',
      registration_version: 1,
      objects: [],
    }));

    const failure = runCliRaw(
      'provider',
      'sync',
      '--sync-url',
      'https://catalog.example.test/ocp/objects/sync',
      '--input',
      syncPath,
      '--api-key',
      'ocp_pk_test',
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'validation_error',
        details: {
          code: 'protocol_schema_error',
          issues: expect.arrayContaining([
            expect.objectContaining({
              path: 'objects',
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(failure.stderr)).not.toContain('Failed to fetch');
  });

  test('provider sync requires api key before sending object payloads', () => {
    mkdirSync(tmpRoot, { recursive: true });
    const syncPath = path.join(tmpRoot, 'sync.json');
    writeFileSync(syncPath, JSON.stringify({
      ocp_version: '1.0',
      kind: 'ObjectSyncRequest',
      catalog_id: 'cat_test',
      provider_id: 'provider_test',
      registration_version: 1,
      batch_id: 'batch_1',
      objects: [{ object_id: 'product_1' }],
    }));

    const failure = runCliRaw(
      'provider',
      'sync',
      '--sync-url',
      'https://catalog.example.test/ocp/objects/sync',
      '--input',
      syncPath,
    );

    expect(failure.status).toBe(1);
    expect(failure.stderr).toMatchObject({
      error: {
        code: 'cli_error',
        message: 'Missing required --api-key',
      },
    });
    expect(JSON.stringify(failure.stderr)).not.toContain('Failed to fetch');
  });

  test('redacts provider api key from register output after saving it', () => {
    const output = redactSavedProviderApiKey({
      ocp_version: '1.0',
      kind: 'RegistrationResult',
      id: 'reg_result_1',
      catalog_id: 'cat_test',
      provider_id: 'provider_test',
      status: 'accepted_full',
      matched_object_contract_count: 1,
      missing_required_fields: [],
      warnings: [],
      provider_api_key: 'ocp_pk_secret',
      provider_api_key_issued_at: '2026-06-07T00:00:00.000Z',
    }, '.provider-api-key');

    expect(output).toMatchObject({
      provider_api_key_saved_to: '.provider-api-key',
      provider_api_key_issued_at: '2026-06-07T00:00:00.000Z',
    });
    expect(JSON.stringify(output)).not.toContain('ocp_pk_secret');
  });
});
