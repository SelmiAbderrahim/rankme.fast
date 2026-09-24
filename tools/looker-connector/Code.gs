/**
 * RankMeFast Looker Studio Community Connector.
 *
 * Source artifact only: copy this file into a Google Apps Script project.
 * The connector has no built-in RankMeFast origin. Each data source supplies
 * its own HTTPS instance URL, and Google stores the API key as KEY auth rather
 * than exposing it through getConfig().
 *
 * Google connector contract (retrieved 2026-08-04):
 * https://developers.google.com/looker-studio/connector/build
 * https://developers.google.com/looker-studio/connector/auth
 */

var cc = DataStudioApp.createCommunityConnector();
var KEY_PROPERTY = 'dscc.key';
var MAX_CONNECTOR_ROWS = 10000;
var PAGE_SIZES = {
  rank_history: 10,
  keywords: 1000,
  serp_features: 1000,
  backlink_rows: 1000,
};

var DATASETS = {
  sites: {
    label: 'Sites',
    needsSite: false,
    paginated: false,
    fields: [
      field('id', 'Site ID', 'TEXT'),
      field('domain', 'Domain', 'TEXT'),
      field('url', 'URL', 'URL'),
      field('paused', 'Paused', 'BOOLEAN'),
      field('created_at', 'Created at', 'YEAR_MONTH_DAY_SECOND'),
    ],
  },
  rank_history: {
    label: 'Rank history',
    needsSite: true,
    paginated: true,
    fields: [
      field('keyword_id', 'Keyword ID', 'TEXT'),
      field('phrase', 'Phrase', 'TEXT'),
      field('engine', 'Engine', 'TEXT'),
      field('checked_at', 'Checked at', 'YEAR_MONTH_DAY_SECOND'),
      metric('position', 'Position'),
      metric('rank_absolute', 'Absolute rank'),
      field('source', 'Source', 'TEXT'),
      field('found_url', 'Found URL', 'URL'),
      field('ai_overview_present', 'AI Overview present', 'BOOLEAN'),
      field('ai_cited', 'AI cited', 'BOOLEAN'),
      field('ai_cited_url', 'AI cited URL', 'URL'),
    ],
  },
  keywords: {
    label: 'Keywords',
    needsSite: false,
    paginated: true,
    fields: [
      field('id', 'Keyword ID', 'TEXT'),
      field('site_id', 'Site ID', 'TEXT'),
      field('phrase', 'Phrase', 'TEXT'),
      field('location_code', 'Location code', 'NUMBER'),
      field('language_code', 'Language code', 'TEXT'),
      field('device', 'Device', 'TEXT'),
      field('active', 'Active', 'BOOLEAN'),
      field('created_at', 'Created at', 'YEAR_MONTH_DAY_SECOND'),
      field('updated_at', 'Updated at', 'YEAR_MONTH_DAY_SECOND'),
      metric('latest_position', 'Latest position'),
      metric('previous_position', 'Previous position'),
      metric('delta', 'Position change'),
      field('last_checked_at', 'Last checked at', 'YEAR_MONTH_DAY_SECOND'),
      field('ai_overview_present', 'AI Overview present', 'BOOLEAN'),
      field('ai_cited', 'AI cited', 'BOOLEAN'),
      field('ai_cited_url', 'AI cited URL', 'URL'),
      field('track_local_pack', 'Track local pack', 'BOOLEAN'),
      field('last_failed_check_at', 'Last failed check at', 'YEAR_MONTH_DAY_SECOND'),
      field('last_failed_reason', 'Last failed reason', 'TEXT'),
      field('engine', 'Engine', 'TEXT'),
      field('engine_target', 'Engine target', 'TEXT'),
    ],
  },
  serp_features: {
    label: 'SERP features',
    needsSite: true,
    paginated: true,
    fields: [
      field('id', 'Observation ID', 'TEXT'),
      field('site_id', 'Site ID', 'TEXT'),
      field('keyword_id', 'Keyword ID', 'TEXT'),
      field('engine', 'Engine', 'TEXT'),
      field('checked_at', 'Checked at', 'YEAR_MONTH_DAY_SECOND'),
      field('source', 'Cache source', 'TEXT'),
      field('features_json', 'Features JSON', 'TEXT'),
      field('top_results_json', 'Top results JSON', 'TEXT'),
      field('created_at', 'Created at', 'YEAR_MONTH_DAY_SECOND'),
      field('source_kind', 'Observation label', 'TEXT'),
    ],
  },
  backlink_rows: {
    label: 'Backlink rows',
    needsSite: true,
    paginated: true,
    fields: [
      field('id', 'Row ID', 'TEXT'),
      field('review_id', 'Review ID', 'TEXT'),
      field('site_id', 'Site ID', 'TEXT'),
      field('url', 'Backlink URL', 'URL'),
      field('domain', 'Backlink domain', 'TEXT'),
      metric('spam_score', 'Spam score'),
      field('rubric_band', 'Rubric band', 'TEXT'),
      field('rubric_version', 'Rubric version', 'TEXT'),
      field('first_seen', 'First seen', 'YEAR_MONTH_DAY_SECOND'),
      field('last_seen', 'Last seen', 'YEAR_MONTH_DAY_SECOND'),
      field('dofollow', 'Dofollow', 'BOOLEAN'),
      field('is_broken', 'Broken', 'BOOLEAN'),
      field('rationale', 'Rationale', 'TEXT'),
      field('rationale_status', 'Rationale status', 'TEXT'),
      field('captured_at', 'Captured at', 'YEAR_MONTH_DAY_SECOND'),
      field('source_kind', 'Observation label', 'TEXT'),
    ],
  },
};

function field(id, name, type) {
  return { id: id, name: name, type: type, metric: false };
}

function metric(id, name) {
  return { id: id, name: name, type: 'NUMBER', metric: true };
}

function getAuthType() {
  return cc.newAuthTypeResponse().setAuthType(cc.AuthType.KEY).build();
}

function setCredentials(request) {
  var key = request && request.key;
  if (typeof key !== 'string' || !/^rmf_[A-Za-z0-9_-]{40}$/.test(key)) {
    return { errorCode: 'INVALID_CREDENTIALS' };
  }
  PropertiesService.getUserProperties().setProperty(KEY_PROPERTY, key);
  return { errorCode: 'NONE' };
}

function isAuthValid() {
  var key = PropertiesService.getUserProperties().getProperty(KEY_PROPERTY);
  return typeof key === 'string' && /^rmf_[A-Za-z0-9_-]{40}$/.test(key);
}

function resetAuth() {
  PropertiesService.getUserProperties().deleteProperty(KEY_PROPERTY);
}

function getConfig() {
  var config = cc.getConfig();
  config
    .newInfo()
    .setId('instructions')
    .setText('Enter your own RankMeFast instance URL, choose a dataset, and add a site ID when the dataset is site-scoped. Your API key is entered through the separate Google key-auth prompt.');
  config
    .newTextInput()
    .setId('instanceUrl')
    .setName('Instance URL')
    .setHelpText('HTTPS origin only, without /api/v1 or a trailing path.')
    .setPlaceholder('https://seo.example.org')
    .setAllowOverride(false);

  var dataset = config
    .newSelectSingle()
    .setId('dataset')
    .setName('Dataset')
    .setHelpText('The dataset controls the Looker field schema.')
    .setAllowOverride(false);
  Object.keys(DATASETS).forEach(function (id) {
    dataset.addOption(config.newOptionBuilder().setLabel(DATASETS[id].label).setValue(id));
  });

  config
    .newTextInput()
    .setId('siteId')
    .setName('Site ID (site-scoped datasets)')
    .setHelpText('Required for rank history, SERP features, and backlink rows.')
    .setPlaceholder('24-character site ID')
    .setAllowOverride(false);

  var engine = config
    .newSelectSingle()
    .setId('engine')
    .setName('Rank-history engine')
    .setHelpText('Used only for rank history. All returns every engine.')
    .setAllowOverride(false);
  [
    ['All', 'all'],
    ['Google', 'google'],
    ['Bing', 'bing'],
    ['YouTube', 'youtube'],
    ['Amazon', 'amazon'],
  ].forEach(function (option) {
    engine.addOption(config.newOptionBuilder().setLabel(option[0]).setValue(option[1]));
  });

  config.setDateRangeRequired(false);
  config.setIsSteppedConfig(false);
  return config.build();
}

function getSchema(request) {
  var selected = validateConfig(request && request.configParams);
  return { schema: buildFields(selected.dataset).build() };
}

function getData(request) {
  var selected = validateConfig(request && request.configParams);
  var allFields = buildFields(selected.dataset);
  var requestedIds = (request.fields || []).map(function (item) {
    return item.name;
  });
  var requestedFields = allFields.forIds(requestedIds);
  var rows = fetchCsvRows(selected, request && request.dateRange);
  var definitions = indexFields(DATASETS[selected.dataset].fields);

  return {
    schema: requestedFields.build(),
    rows: rows.map(function (row) {
      return {
        values: requestedIds.map(function (id) {
          return convertValue(row[id], definitions[id]);
        }),
      };
    }),
  };
}

function buildFields(datasetId) {
  var fields = cc.getFields();
  DATASETS[datasetId].fields.forEach(function (definition) {
    var builder = definition.metric
      ? fields.newMetric().setAggregation(cc.AggregationType.AVG)
      : fields.newDimension();
    builder
      .setId(definition.id)
      .setName(definition.name)
      .setType(cc.FieldType[definition.type]);
  });
  return fields;
}

function indexFields(definitions) {
  var indexed = {};
  definitions.forEach(function (definition) {
    indexed[definition.id] = definition;
  });
  return indexed;
}

function validateConfig(raw) {
  var config = raw || {};
  var instanceUrl = normalizeInstanceUrl(config.instanceUrl);
  var dataset = config.dataset;
  if (!Object.prototype.hasOwnProperty.call(DATASETS, dataset)) {
    userError('Choose a supported RankMeFast dataset.', 'Invalid dataset configuration.');
  }
  var siteId = config.siteId || '';
  if (DATASETS[dataset].needsSite && !/^[0-9a-f]{24}$/i.test(siteId)) {
    userError('Enter the 24-character site ID for this dataset.', 'Missing or invalid site ID.');
  }
  var engine = config.engine || 'all';
  if (['all', 'google', 'bing', 'youtube', 'amazon'].indexOf(engine) === -1) {
    userError('Choose a supported rank engine.', 'Invalid engine configuration.');
  }
  return {
    instanceUrl: instanceUrl,
    dataset: dataset,
    siteId: siteId,
    engine: engine,
  };
}

function normalizeInstanceUrl(value) {
  if (typeof value !== 'string') {
    userError('Enter your RankMeFast instance URL.', 'Instance URL was not a string.');
  }
  var trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\/?#@]+$/i.test(trimmed)) {
    userError('Use an HTTPS instance origin without a path.', 'Rejected instance URL.');
  }
  return trimmed;
}

function endpointFor(config) {
  if (config.dataset === 'sites') return '/api/v1/sites';
  if (config.dataset === 'keywords') return '/api/v1/keywords';
  if (config.dataset === 'rank_history') {
    return '/api/v1/sites/' + encodeURIComponent(config.siteId) + '/rank-history';
  }
  if (config.dataset === 'serp_features') return '/api/v1/serp-features';
  return '/api/v1/backlink-rows';
}

function queryFor(config, cursor, dateRange) {
  var query = ['format=csv'];
  if (config.dataset === 'serp_features' || config.dataset === 'backlink_rows') {
    query.push('siteId=' + encodeURIComponent(config.siteId));
  }
  if (DATASETS[config.dataset].paginated) {
    query.push('limit=' + PAGE_SIZES[config.dataset]);
    if (cursor) query.push('cursor=' + encodeURIComponent(cursor));
  }
  if (config.dataset === 'rank_history' && config.engine !== 'all') {
    query.push('engine=' + encodeURIComponent(config.engine));
  }
  if (config.dataset === 'rank_history' && dateRange) {
    var from = lookerDateBound(dateRange.startDate, false);
    var to = lookerDateBound(dateRange.endDate, true);
    if (from) query.push('from=' + encodeURIComponent(from));
    if (to) query.push('to=' + encodeURIComponent(to));
  }
  return query.join('&');
}

function lookerDateBound(value, endOfDay) {
  if (value === undefined || value === null || value === '') return '';
  var match = String(value).match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!match) {
    userError('Choose a valid Looker Studio date range.', 'Invalid date-range shape.');
  }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    userError('Choose a valid Looker Studio date range.', 'Invalid calendar date.');
  }
  var isoDay =
    String(year).padStart(4, '0') +
    '-' +
    String(month).padStart(2, '0') +
    '-' +
    String(day).padStart(2, '0');
  return isoDay + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z');
}

function fetchCsvRows(config, dateRange) {
  var key = PropertiesService.getUserProperties().getProperty(KEY_PROPERTY);
  if (!key) userError('Reconnect and enter your RankMeFast API key.', 'No stored key.');

  var path = endpointFor(config);
  var rows = [];
  var cursor = '';
  var seenCursors = {};
  do {
    var response = UrlFetchApp.fetch(
      config.instanceUrl + path + '?' + queryFor(config, cursor, dateRange),
      {
        method: 'get',
        headers: {
          Authorization: 'Bearer ' + key,
          Accept: 'text/csv',
        },
        muteHttpExceptions: true,
      },
    );
    var status = response.getResponseCode();
    if (status !== 200) {
      userError(
        'RankMeFast could not return this dataset (HTTP ' + status + '). Check the instance URL, key, plan, feature flag, and site ID.',
        'RankMeFast request failed at ' + path + ' with status ' + status + '.',
      );
    }
    var page = parseCsv(response.getContentText());
    rows = rows.concat(page).slice(0, MAX_CONNECTOR_ROWS);
    var headers = response.getHeaders();
    var next = headers['X-Next-Cursor'] || headers['x-next-cursor'] || '';
    if (!DATASETS[config.dataset].paginated || !next || rows.length >= MAX_CONNECTOR_ROWS) {
      cursor = '';
    } else if (seenCursors[next]) {
      userError('RankMeFast returned a repeated page cursor.', 'Repeated cursor at ' + path + '.');
    } else {
      seenCursors[next] = true;
      cursor = next;
    }
  } while (cursor);
  return rows;
}

function parseCsv(text) {
  var table = Utilities.parseCsv(text);
  if (!table.length) return [];
  var headers = table[0];
  headers[0] = (headers[0] || '').replace(/^\uFEFF/, '');
  return table.slice(1).filter(function (cells) {
    return cells.some(function (cell) {
      return cell !== '';
    });
  }).map(function (cells) {
    var row = {};
    headers.forEach(function (header, index) {
      row[header] = cells[index] === undefined ? '' : cells[index];
    });
    return row;
  });
}

function convertValue(value, definition) {
  if (!definition || value === undefined || value === '') return null;
  if (definition.type === 'NUMBER') {
    var number = Number(value);
    return isFinite(number) ? number : null;
  }
  if (definition.type === 'BOOLEAN') return value === 'true';
  if (definition.type === 'YEAR_MONTH_DAY_SECOND') {
    var digits = String(value).replace(/\D/g, '').slice(0, 14);
    return digits.length === 14 ? digits : null;
  }
  return value;
}

function userError(text, debugText) {
  cc.newUserError().setText(text).setDebugText(debugText).throwException();
}
