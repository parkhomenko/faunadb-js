'use strict'
var qs = require('querystring')
var errors = require('../errors')
var http2 = require('http2')

/**
 * Http client adapter built around NodeJS http2 module.
 *
 * @constructor
 * @private
 */
function Http2Adapter() {
  this._sessionMap = {}
}

/**
 * Resolves ClientHttp2Session to be reused across multiple connections.
 *
 * @param {string} origin Request origin to connect to.
 *
 * @returns {ClientHttp2Session} Http2 session.
 */
Http2Adapter.prototype._resolveSessionFor = function(origin) {
  if (!this._sessionMap[origin]) {
    var self = this

    var cleanup = function() {
      self._cleanupSessionFor(origin)
    }

    this._sessionMap[origin] = http2
      .connect(origin)
      .once('error', cleanup)
      .once('goaway', cleanup)
  }

  return this._sessionMap[origin]
}

/**
 * Performs cleanup for broken session.
 *
 * @param {string} origin Origin perform cleanup for.
 *
 * @returns {void}
 */
Http2Adapter.prototype._cleanupSessionFor = function(origin) {
  if (this._sessionMap[origin]) {
    delete this._sessionMap[origin]
  }
}

/**
 * Issues http requests using http2 module.
 *
 * @param {object} options Request options.
 * @param {object} options.url URL object.
 * @param {string} options.method Request method.
 * @param {?object} options.headers Request headers.
 * @param {?string} options.body Request body string.
 * TODO: handle responseType
 * @param {?'text' | 'stream'} options.responseType Response type.
 * @param {?number} options.timeout Request timeout.
 *
 * @returns {Promise} Request result.
 */
Http2Adapter.prototype.execute = function(options) {
  var self = this
  var origin = options.url.origin

  return new Promise(function(resolve, reject) {
    try {
      var session = self._resolveSessionFor(origin)
      var querystring = options.url.query && qs.stringify(options.url.query)
      var pathname = querystring
        ? options.url.pathname + '?' + querystring
        : options.url.pathname
      var headers = Object.assign({}, options.headers, {
        [http2.constants.HTTP2_HEADER_PATH]: pathname,
        [http2.constants.HTTP2_HEADER_METHOD]: options.method,
      })
      var request = session
        .request(headers)
        .setEncoding('utf8')
        .on('error', reject)
        .on('response', function(headers) {
          var responseContent = ''

          request
            .on('data', function(chunk) {
              responseContent += chunk
            })
            .on('end', function() {
              resolve({
                status: headers[http2.constants.HTTP2_HEADER_STATUS],
                headers: headers,
                body: responseContent,
              })
            })
        })

      if (options.timeout) {
        request.setTimeout(options.timeout, function() {
          request.close(http2.constants.NGHTTP2_CANCEL)
          reject(new errors.TimeoutError('Request failed due to timeout'))
        })
      }

      if (options.body != null) {
        request.write(options.body)
      }

      request.end()
    } catch (error) {
      self._cleanupSessionFor(origin)
      reject(error)
    }
  })
}

module.exports = Http2Adapter
