'use strict'

var APIVersion = '4'

var parse = require('url-parse')
var util = require('../_util')
var FetchAdapter = require('./fetchAdapter')
// var Http2Adapter = require('./http2Adapter')

/**
 * The driver's internal HTTP client.
 *
 * @constructor
 * @param {Object} options Same as the {@link Client} options.
 * @private
 */
function HttpClient(options) {
  var isHttps = options.scheme === 'https'

  if (options.port == null) {
    options.port = isHttps ? 443 : 80
  }

  this._adapter = new FetchAdapter({
    isHttps: isHttps,
    fetch: options.fetch,
    keepAlive: options.keepAlive,
  })
  // this._adapter = new Http2Adapter()
  this._baseUrl = options.scheme + '://' + options.domain + ':' + options.port
  this._secret = options.secret
  this._headers = options.headers
  this._queryTimeout = options.queryTimeout
  this._lastSeen = null
  this._timeout = Math.floor(options.timeout * 1000)
}

/**
 * Returns last seen transaction time.
 * @returns {number} The last seen transaction time.
 */
HttpClient.prototype.getLastTxnTime = function() {
  return this._lastSeen
}

/**
 * Sets the last seen transaction if the given timestamp is greater than then
 * know last seen timestamp.
 *
 * @param {number} time transaction timestamp.
 */
HttpClient.prototype.syncLastTxnTime = function(time) {
  if (this._lastSeen == null || this._lastSeen < time) {
    this._lastSeen = time
  }
}

/**
 * Executes an HTTP request.
 *
 * @param {object} options Request parameters.
 * @param {?string} options.method Request method.
 * @param {?string} options.path Request path.
 * @param {?string} options.body Request body.
 * @param {?object} options.query Request query.
 * @param {?'text' | 'stream'} options.responseType Response type.
 * @params {?object} options.streamConsumer Stream consumer,
 * required when responseType is "stream".
 * // TODO: do we need a signal to abort outside? Ideally should be avoided
 * @param {?object} options.signal Abort signal object.
 * @param {?object} options.fetch Fetch API compatible function.
 * @param {?object} options.secret FaunaDB secret.
 * @param {?object} options.queryTimeout FaunaDB query timeout.
 *
 * @returns {Promise} The response promise.
 */
HttpClient.prototype.execute = function(options) {
  options = options || {}

  var url = parse(this._baseUrl)
    .set('pathname', options.path || '')
    .set('query', options.query || {})
  var secret = options.secret || this._secret
  var queryTimeout = options.queryTimeout || this._queryTimeout
  var headers = this._headers

  headers['Authorization'] = secret && secretHeader(secret)
  headers['X-FaunaDB-API-Version'] = APIVersion
  headers['X-Fauna-Driver'] = 'Javascript'
  headers['X-Last-Seen-Txn'] = this._lastSeen
  headers['X-Query-Timeout'] = queryTimeout

  if (options.responseType === 'stream' && !options.streamConsumer) {
    return Promise.reject(new TypeError('Invalid "streamConsumer" parameter'))
  }

  return this._adapter.execute({
    url: url,
    method: options.method || 'GET',
    headers: util.removeNullAndUndefinedValues(headers),
    body: options.body,
    timeout: this._timeout,
    responseType: options.responseType,
    streamConsumer: options.streamConsumer,
  })
}

/** @ignore */
function secretHeader(secret) {
  return 'Bearer ' + secret
}

module.exports = {
  HttpClient: HttpClient,
}
