'use strict'
var AbortController = require('abort-controller')
var errors = require('../errors')
var util = require('../_util')

/**
 * Http client adapter built around fetch API.
 *
 * @constructor
 * @param {?object} options FetchAdapter options.
 * @param {?boolean} options.keepAlive Whether use keep-alive connection.
 * @param {?boolean} options.isHttps Whether use https connection.
 * @param {?function} options.fetch Fetch compatible API.
 * @private
 */
function FetchAdapter(options) {
  options = options || {}

  this._fetch = resolveFetch(options.fetch)

  if (util.isNodeEnv() && options.keepAlive) {
    this._keepAliveAgent = new (options.isHttps
      ? require('https')
      : require('http')
    ).Agent({ keepAlive: true })
  }
}

/**
 * Attaches streamConsumer specifically either for browser or NodeJS.
 * Minimum browser compatibility based on current code:
 * Chrome                52
 * Edge                  79
 * Firefox               65
 * IE                    NA
 * Opera                 39
 * Safari                10.1
 * Android Webview       52
 * Chrome for Android    52
 * Firefox for Android   65
 * Opera for Android     41
 * Safari on iOS         10.3
 * Samsung Internet      6.0
 *
 * @param response Fetch response.
 * @param streamConsumer StreamConsumer.
 * @private
 */
FetchAdapter.prototype._attachStreamConsumer = function(
  response,
  streamConsumer
) {
  if (util.isNodeEnv()) {
    response.body
      .on('error', streamConsumer.onError)
      .on('data', streamConsumer.onData)
      .on('end', streamConsumer.onEnd)

    return
  }

  // ATTENTION: The following code is meant to run in browsers and is not
  // covered by current test automation. Manual testing on major browsers
  // is required after making changes to it.
  try {
    var reader = response.body.getReader()
    var decoder = new TextDecoder('utf-8')

    function pump() {
      return reader.read().then(function(msg) {
        if (!msg.done) {
          var chunk = decoder.decode(msg.value, { stream: true })

          streamConsumer.onData(chunk)

          return pump()
        }

        streamConsumer.onEnd()
      })
    }

    pump().catch(streamConsumer.onError)
  } catch (err) {
    throw new errors.StreamsNotSupported(
      'Unexpected error during stream initialization: ' + err
    )
  }
}

/**
 * Issues http requests using fetch API
 *
 * @param {object} options Request options.
 * @param {object} options.url URL object.
 * @param {string} options.method Request method.
 * @param {?object} options.headers Request headers.
 * @param {?string} options.body Request body utf8 string.
 * @param {?'text' | 'stream'} options.responseType Response type.
 * @params {?object} options.streamConsumer Stream consumer,
 * required when responseType is "stream".
 * @param {?number} options.timeout Request timeout.
 *
 * @returns {Promise} Request result.
 */
FetchAdapter.prototype.execute = function(options) {
  var self = this
  var signal
  var timerId

  if (options.timeout) {
    var ctrl = new AbortController()

    signal = ctrl.signal
    timerId = setTimeout(ctrl.abort.bind(ctrl), options.timeout)
  }

  var onResponse = function(response) {
    if (timerId) {
      clearTimeout(timerId)
    }

    var headers = responseHeadersAsObject(response.headers)
    var processStream = response.ok && options.responseType === 'stream'

    if (!processStream) {
      return response.text().then(function(content) {
        return {
          body: content,
          headers: headers,
          status: response.status,
        }
      })
    }

    self._attachStreamConsumer(response, options.streamConsumer)

    return {
      body: '[stream]',
      headers: headers,
      status: response.status,
    }
  }

  var onError = function(error) {
    if (timerId) {
      clearTimeout(timerId)
    }

    // Don't remap to TimeoutError if options.timeout is not set or set to 0
    var isTimeoutError = !!options.timeout && error.name === 'AbortError'

    return Promise.reject(
      isTimeoutError
        ? new errors.TimeoutError('Request failed due to timeout')
        : error
    )
  }

  return this._fetch(options.url.href, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    agent: this._keepAliveAgent,
    signal: signal,
  }).then(onResponse, onError)
}

/**
 * Resolves which Fetch API compatible function to use. If an override is
 * provided, returns the override. If no override and the global (window) has
 * "fetch" property, return the native fetch. Otherwise returns the cross-fetch polyfill.
 *
 * @param {?function} fetchOverride An Fetch API compatible function to use.
 * @returns {function} A Fetch API compatible function.
 * @private
 */
function resolveFetch(fetchOverride) {
  if (typeof fetchOverride === 'function') {
    return fetchOverride
  }

  if (typeof global.fetch === 'function') {
    // NB. Rebinding to global is needed for Safari
    return global.fetch.bind(global)
  }

  return require('cross-fetch')
}

/**
 * Converts fetch Headers object into POJO.
 * @param {object} headers Fetch Headers object.
 * @returns {object} Response headers as a plain object.
 * @private
 */
function responseHeadersAsObject(headers) {
  var result = {}

  for (var header of headers.entries()) {
    var key = header[0]
    var value = header[1]

    result[key] = value
  }

  return result
}

module.exports = FetchAdapter
