import {readFile, writeFile, rename, mkdir, access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {browserContext,assertBrowserContext} from './lib/browser-context.mjs';

const ORIGIN = 'https://business.facebook.com';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = () => new Date().toISOString();
const id = value => /^\d+$/.test(String(value || ''));

// Runs in the selected Chrome or AdsPower tab on the Meta origin.
// Session values stay inside that browser; no Cookie export or token storage.
async function browserRequest(p) {
  if (location.origin !== 'https://business.facebook.com') throw new Error('META_ORIGIN_REQUIRED');
  const selectedCatalog = location.pathname.match(/\/commerce\/(?:catalogs\/)?(\d+)(?:\/|$)/)?.[1];
  if (selectedCatalog !== p.catalogId) throw new Error('CATALOG_CONTEXT_MISMATCH');
  const selectedBusiness = new URL(location.href).searchParams.get('business_id');
  if (selectedBusiness && selectedBusiness !== p.businessId) throw new Error('BUSINESS_CONTEXT_MISMATCH');
  const actor = require('CurrentUserInitialData').USER_ID;
  if (!actor || actor === '0') throw new Error('LOGIN_REQUIRED');
  if (p.actorId && actor !== p.actorId) throw new Error('LOGIN_ACCOUNT_CHANGED');
  const asyncParams = require('getAsyncParams')('POST');
  const dtsg = require('DTSGInitialData').token;
  const lsd = require('LSD').token;
  if (!asyncParams || !dtsg || !lsd) throw new Error('SESSION_MODULES_UNAVAILABLE');
  if (p.kind === 'session') return {actor_id: actor, catalog_id: selectedCatalog, business_id: selectedBusiness || p.businessId, session_ready: true};
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(asyncParams)) if (value !== undefined && value !== null) params.set(key, String(value));
  params.set('__user', actor);
  params.set('__a', '1');
  params.set('fb_dtsg', dtsg);
  params.set('lsd', lsd);
  let url, body;
  const headers = {'x-fb-lsd': lsd};
  if (p.kind === 'upload') {
    url = new URL('/product_feeds/upload/', location.origin);
    params.set('business_id', p.businessId);
    url.search = params.toString();
    const bytes = Uint8Array.from(atob(p.csvBase64), c => c.charCodeAt(0));
    body = new FormData();
    body.append('file', new File([bytes], p.filename, {type: 'text/csv'}));
  } else if (p.kind === 'graphql') {
    url = new URL('/api/graphql/', location.origin);
    params.set('av', actor);
    params.set('fb_api_caller_class', 'RelayModern');
    params.set('fb_api_req_friendly_name', p.operation.friendly_name);
    params.set('doc_id', p.operation.doc_id);
    params.set('server_timestamps', 'true');
    params.set('variables', JSON.stringify(p.variables));
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['x-fb-friendly-name'] = p.operation.friendly_name;
    body = params.toString();
  } else throw new Error('UNSUPPORTED_REQUEST_KIND');
  const response = await fetch(url.toString(), {method: 'POST', credentials: 'include', headers, body, redirect: 'error', signal: AbortSignal.timeout(20000)});
  const text = (await response.text()).replace(/^for\s*\(;;\);\s*/, '');
  let result;
  try { result = JSON.parse(text); }
  catch { result = {parse_error: true}; }
  return {http_status: response.status, response_origin: new URL(response.url).origin, body: result};
}

function safeMessage(value) {
  return String(value || '').replace(/https?:\/\/[^\s"<>]+/g, '[URL]').replace(/[A-Za-z0-9_-]{80,}/g, '[OPAQUE_VALUE]').slice(0, 800);
}

function checkedResponse(result) {
  if (result?.http_status !== 200 || result?.response_origin !== ORIGIN || result?.body?.parse_error) {
    throw new Error(`META_RESPONSE_UNCONFIRMED: HTTP ${result?.http_status ?? 'unknown'}; check login, current operation IDs and request outcome.`);
  }
  if (result.body?.errors?.length || result.body?.error) {
    const messages = (result.body.errors || []).map(e => safeMessage(e.message || e.description || e.summary));
    if (result.body.error) messages.push(safeMessage(result.body.errorSummary || result.body.errorDescription || result.body.error));
    throw new Error(`META_API_ERROR: ${messages.join('; ')}`);
  }
  return result.body;
}

export async function createCatalogClient({cdp, catalogId, businessId, journalPath, operationsPath, manifestPath, expectedActorId, resume = false}) {
  const context=browserContext(cdp);
  catalogId = String(catalogId || '');
  businessId = String(businessId || '');
  if (!cdp?.send || !id(catalogId) || !id(businessId)) throw new Error('A documented Chrome CDP capability and explicit catalog/business IDs are required.');
  const recipe = JSON.parse(await readFile(operationsPath || new URL('../references/catalog-operations.json', import.meta.url), 'utf8'));
  if (recipe.origin !== ORIGIN) throw new Error('Unexpected recipe origin.');
  const manifest = manifestPath ? JSON.parse(await readFile(manifestPath, 'utf8')) : null;
  if (manifest && (manifest.errors?.length || !manifest.upload_path || !manifest.row_count || new Set(manifest.ids).size !== manifest.row_count)) throw new Error('CSV preflight failed or manifest is incomplete.');
  const runId = randomUUID();
  let actorId = expectedActorId, fileMeta, preview, feedId, sessionId, lastCheck;
  let journalStarted = false;
  const attempts = new Set();
  let journal = {version: 1, run_id: runId, catalog_id: catalogId, business_id: businessId,browser_context:context,
    csv_sha256: manifest?.upload_sha256, filename: manifest?.upload_filename,
    expected_products: manifest?.row_count, currencies: manifest?.currencies, events: []};

  if (resume) {
    if (!journalPath) throw new Error('RESUME_JOURNAL_REQUIRED');
    journal = JSON.parse(await readFile(journalPath, 'utf8'));
    assertBrowserContext(journal.browser_context,context);
    if (journal.catalog_id !== catalogId || journal.business_id !== businessId || !journal.actor_id) throw new Error('RESUME_TARGET_MISMATCH');
    if (expectedActorId && expectedActorId !== journal.actor_id) throw new Error('LOGIN_ACCOUNT_CHANGED');
    if (manifest && manifest.upload_sha256 !== journal.csv_sha256) throw new Error('RESUME_CSV_MISMATCH');
    actorId = journal.actor_id; feedId = journal.feed_id; sessionId = journal.upload_session_id;
    journalStarted = true;
  }
  const expectedProducts = manifest?.row_count ?? journal.expected_products;

  async function event(step, status, details = {}) {
    if (!journalPath) throw new Error('A task-local journalPath is required before upload or mutation.');
    if (!journalStarted) {
      await mkdir(dirname(journalPath), {recursive: true});
      try { await writeFile(journalPath, JSON.stringify(journal), {flag: 'wx', mode: 0o600}); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('JOURNAL_ALREADY_EXISTS: reconcile the previous run.'); throw error; }
      journalStarted = true;
    }
    journal.events.push({step, status, at: stamp(), ...details});
    journal.state = status === 'complete' ? 'complete' : `${step}:${status}`;
    await mkdir(dirname(journalPath), {recursive: true});
    const temporary = `${journalPath}.${runId}.tmp`;
    await writeFile(temporary, JSON.stringify(journal, null, 2), {mode: 0o600});
    await rename(temporary, journalPath);
  }

  async function call(payload) {
    assertBrowserContext(context,browserContext(cdp));
    let result;
    try {
      result = await cdp.send('Runtime.evaluate', {
        expression: `(${browserRequest.toString()})(${JSON.stringify({catalogId, businessId, actorId, ...payload})})`,
        awaitPromise: true, returnByValue: true,
      }, {timeoutMs: 25000});
    } catch {
      throw new Error('BROWSER_RESULT_UNCONFIRMED: browser call interrupted; reconcile state before retrying a mutation.');
    }
    if (result?.exceptionDetails || !result?.result?.value) {
      // Do not echo raw exception objects, expressions, CSRF values or upload handles.
      throw new Error('BROWSER_REQUEST_UNCONFIRMED: check selected catalog, login and session modules; reconcile any attempted mutation.');
    }
    return result.result.value;
  }

  async function session() {
    const current = await call({kind: 'session'});
    if (actorId && current.actor_id !== actorId) throw new Error('LOGIN_ACCOUNT_CHANGED');
    actorId = current.actor_id;
    journal.actor_id = actorId;
    return current;
  }

  async function graphql(key, variables) {
    const operation = recipe.operations[key];
    if (!operation || !id(operation.doc_id)) throw new Error(`OPERATION_RECIPE_MISSING: ${key}`);
    if (!actorId) await session();
    return checkedResponse(await call({kind: 'graphql', operation, variables}));
  }

  async function mutate(step, operation, summarize) {
    if (resume) throw new Error('RESUME_IS_READ_ONLY: reconcile prior effects before planning a new write.');
    if (attempts.has(step)) throw new Error(`NO_AUTOMATIC_REPLAY: ${step} was already attempted in this run.`);
    attempts.add(step);
    await event(step, 'attempting'); // Durable intent BEFORE the external request.
    try {
      const result = await operation();
      await event(step, 'confirmed', summarize(result));
      return result;
    } catch (error) {
      await event(step, 'unconfirmed', {reason: safeMessage(error.message)});
      throw error;
    }
  }

  async function feedDetails(targetFeedId) {
    if (!id(targetFeedId)) throw new Error('A numeric feed ID is required.');
    const body = await graphql('feedDetails', {catalogID: catalogId, dataSourceID: String(targetFeedId)});
    if (body.data?.catalog?.id !== catalogId || body.data?.dataSource?.id !== String(targetFeedId)) throw new Error('FEED_DETAILS_TARGET_MISMATCH');
    const d = body.data.dataSource;
    return {feed_id: d.id, name: d.name, status: d.data_source_status, product_count: d.product_count,
      last_update_time: d.last_update_time, filename: d.latest_upload?.filename,
      latest_upload_id: d.latest_upload?.id, input_method: d.latest_upload?.input_method};
  }

  return {
    inspectSession: session,
    async listFeeds() {
      const body = await graphql('listFeeds', {catalogID: catalogId});
      const c = body.data?.catalog;
      if (c?.id !== catalogId || !Array.isArray(c.data_sources_v2?.nodes)) throw new Error('FEED_LIST_SCHEMA_CHANGED');
      return c.data_sources_v2.nodes.map(x => ({feed_id: x.data_source_id || x.id, name: x.name, type: x.data_upload_type}));
    },
    feedDetails,
    async upload() {
      if (!manifest) throw new Error('A validated manifestPath is required.');
      if (manifest.upload_bytes > 10 * 1024 * 1024) throw new Error('CSV_TOO_LARGE: use the supported browser file-upload UI for files over 10 MiB.');
      const bytes = await readFile(manifest.upload_path);
      if (sha256(bytes) !== manifest.upload_sha256) throw new Error('CSV_CHANGED_AFTER_VALIDATION');
      await session();
      return mutate('upload_file', async () => {
        const body = checkedResponse(await call({kind: 'upload', filename: manifest.upload_filename, csvBase64: bytes.toString('base64')}));
        if (typeof body.payload?.meta !== 'string' || !body.payload.meta) throw new Error('UPLOAD_HANDLE_MISSING');
        fileMeta = body.payload.meta; // RAM only; never journal this value.
        return {uploaded: true, bytes: bytes.length, filename: manifest.upload_filename};
      }, x => x);
    },
    async preview() {
      if (!fileMeta) throw new Error('Upload the CSV before previewing.');
      const body = await graphql('preview', {catalogID: catalogId, args: {feed_schema_platform: 'META', feed_type: 'PRODUCTS', file_meta: fileMeta}});
      const p = body.data?.catalog?.feedPreview;
      if (!p || !Array.isArray(p.parser_results)) throw new Error('PREVIEW_SCHEMA_CHANGED');
      const ids = p.parser_results.map(r => r.properties?.find(x => x.key === 'id')?.value);
      const expectedIds = new Set(manifest.ids);
      const wrongIds = ids.filter(x => !expectedIds.has(x));
      const rowIssues = p.parser_results.flatMap(r => (r.errors || []).map(e => ({row: r.row_number, field: e.property_key,
        type: e.error_details?.error_type, severity: e.error_details?.severity, message: safeMessage(e.error_details?.description)})));
      const conflicts = Array.isArray(p.items_belonging_to_other_feed) ? p.items_belonging_to_other_feed.length : (p.items_belonging_to_other_feed ? 1 : 0);
      const errors = (p.errors || []).map(e => ({type: e.error_type, summary: safeMessage(e.summary), message: safeMessage(e.description)}));
      const truncated = p.is_truncated === true;
      const countOk = truncated ? ids.length > 0 && ids.length <= manifest.row_count : ids.length === manifest.row_count;
      preview = {ok: p.is_preview_supported === true && !errors.length && !rowIssues.length && !conflicts && !wrongIds.length && new Set(ids).size === ids.length && countOk && !(p.missing_properties || []).length && !(p.invalid_columns || []).length,
        parsed_rows: ids.length, expected_rows: manifest.row_count, truncated,
        columns: p.all_columns, missing_properties: p.missing_properties || [], invalid_columns: p.invalid_columns || [],
        errors, row_issues: rowIssues, conflicting_feed_items: conflicts, unexpected_id_count: wrongIds.length};
      await event('preview', preview.ok ? 'passed' : 'blocked', preview);
      return preview;
    },
    async createFeed({name, defaultCurrency} = {}) {
      if (!preview?.ok) throw new Error('PREVIEW_NOT_PASSED');
      const currency = defaultCurrency || manifest.default_currency;
      if (!/^[A-Z]{3}$/.test(currency || '')) throw new Error('Specify the feed default currency; do not invent or convert product prices.');
      const feedName = name || `${manifest.upload_filename} ${stamp().slice(0, 16)} ${runId.slice(0, 8)}`;
      journal.feed_name = feedName;
      return mutate('create_feed', async () => {
        const body = await graphql('createFeed', {input: {actor_id: actorId, client_mutation_id: `${runId}:feed`, catalog_id: catalogId,
          catalog_item_type: null, configuration_source_name: null, default_currency: currency, feed_schema_platform: 'META', feed_type: 'PRODUCTS',
          name: feedName, override_type: null, primary_feed_ids: [], rules: [], schedule: null, sub_vertical_ingestion_mode: 'AUTODETECT', use_case: null}});
        feedId = body.data?.create_primary_product_feed?.product_feed?.id;
        if (!id(feedId)) throw new Error('CREATE_FEED_RESULT_UNCONFIRMED');
        journal.feed_id = feedId;
        return {feed_id: feedId, name: feedName, default_currency: currency};
      }, x => x);
    },
    async startImport() {
      if (!feedId || !fileMeta || !preview?.ok) throw new Error('Create this run\'s feed after a successful preview before starting import.');
      return mutate('start_import', async () => {
        const body = await graphql('createUpload', {input: {actor_id: actorId, client_mutation_id: `${runId}:upload`, file_meta: fileMeta, product_feed_id: feedId, update_only: false}});
        sessionId = body.data?.create_product_feed_upload_session?.product_feed_upload_session_id;
        if (!id(sessionId)) throw new Error('IMPORT_RESULT_UNCONFIRMED');
        journal.upload_session_id = sessionId;
        return {feed_id: feedId, upload_session_id: sessionId};
      }, x => x);
    },
    async checkResult() {
      if (!feedId || !sessionId) throw new Error('No confirmed upload session in this run.');
      const details = await feedDetails(feedId);
      const sameUpload = details.latest_upload_id === sessionId;
      const countMatches = details.product_count === expectedProducts;
      lastCheck = {...details, expected_products: expectedProducts, upload_matches: sameUpload,
        outcome: sameUpload && countMatches && details.last_update_time ? 'count_matched_verify_ui' : 'not_final'};
      await event('check_result', lastCheck.outcome, lastCheck);
      return lastCheck;
    },
    async recordVerified({feedId: visibleFeedId, productCount, uiStatus, evidencePath}) {
      if (visibleFeedId !== feedId || productCount !== expectedProducts || lastCheck?.outcome !== 'count_matched_verify_ui' || !['All good', '一切正常', '一切良好', 'Completed', '已完成'].includes(uiStatus)) throw new Error('Final UI and API evidence must agree on this feed and expected product count.');
      if (!evidencePath) throw new Error('UI_EVIDENCE_REQUIRED');
      await access(evidencePath);
      await event('verification', 'complete', {feed_id: feedId, product_count: productCount, ui_status: uiStatus, evidence_path: evidencePath});
      return {catalog_id: catalogId, feed_id: feedId, upload_session_id: sessionId, product_count: productCount,
        status: uiStatus, url: `${ORIGIN}/commerce/catalogs/${catalogId}/data_sources/${feedId}/`};
    },
  };
}
