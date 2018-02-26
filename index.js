'use strict'

const { Server, ServerResponse } = require('_http_server')
const { IncomingMessage } = require('_http_incoming')

// override ServerResponse stuff
const stringEncodings = {utf8: true, latin1: true}
ServerResponse.prototype._send = function _send (data, encoding, callback) {
  if (this._headerSent) return this._writeRaw(data, encoding, callback)
  encoding = encoding || 'utf8'
  this._headerSent = true
  if (typeof data === 'string' && stringEncodings[encoding]) {
    return this._writeRaw(this._header + data, encoding, callback)
  }
  let header = this._header
  if (this.output.length === 0) {
    this.output = [header]
    this.outputEncodings = ['latin1']
    this.outputCallbacks = [null]
  } else {
    this.output.unshift(header)
    this.outputEncodings.unshift('latin1')
    this.outputCallbacks.unshift(null)
  }
  this.outputSize += header.length
  this._onPendingData(header.length)
  return this._writeRaw(data, encoding, callback)
}

// override IncomingMessage stuff
const known = {
  'Content-Type': 'content-type',
  'content-type': 'content-type',
  'Content-Length': 'content-length',
  'content-length': 'content-length',
  'User-Agent': 'user-agent',
  'user-agent': 'user-agent',
  'Referer': 'referer',
  'referer': 'referer',
  'Host': 'host',
  'host': 'host',
  'Authorization': 'authorization',
  'authorization': 'authorization',
  'Proxy-Authorization': 'proxy-authorization',
  'proxy-authorization': 'proxy-authorization',
  'If-Modified-Since': 'if-modified-since',
  'if-modified-since': 'if-modified-since',
  'If-Unmodified-Since': 'if-unmodified-since',
  'if-unmodified-since': 'if-unmodified-since',
  'From': 'from',
  'from': 'from',
  'Location': 'location',
  'location': 'location',
  'Max-Forwards': 'max-forwards',
  'max-forwards': 'max-forwards',
  'Retry-After': 'retry-after',
  'retry-after': 'retry-after',
  'ETag': 'etag',
  'etag': 'etag',
  'Last-Modified': 'last-modified',
  'last-modified': 'last-modified',
  'Server': 'server',
  'server': 'server',
  'Age': 'age',
  'age': 'age',
  'Expires': 'expires',
  'expires': 'expires',
  'Set-Cookie': '\u0001',
  'set-cookie': '\u0001',
  'Cookie': '\u0002cookie',
  'cookie': '\u0002cookie',
  'Transfer-Encoding': '\u0000transfer-encoding',
  'transfer-encoding': '\u0000transfer-encoding',
  'Date': '\u0000date',
  'date': '\u0000date',
  'Connection': '\u0000connection',
  'connection': '\u0000connection',
  'Cache-Control': '\u0000cache-control',
  'cache-control': '\u0000cache-control',
  'Vary': '\u0000vary',
  'vary': '\u0000vary',
  'Content-Encoding': '\u0000content-encoding',
  'content-encoding': '\u0000content-encoding',
  'Origin': '\u0000origin',
  'origin': '\u0000origin',
  'Upgrade': '\u0000upgrade',
  'upgrade': '\u0000upgrade',
  'Expect': '\u0000expect',
  'expect': '\u0000expect',
  'If-Match': '\u0000if-match',
  'if-match': '\u0000if-match',
  'If-None-Match': '\u0000if-none-match',
  'if-none-match': '\u0000if-none-match',
  'Accept': '\u0000accept',
  'accept': '\u0000accept',
  'Accept-Encoding': '\u0000accept-encoding',
  'accept-encoding': '\u0000accept-encoding',
  'Accept-Language': '\u0000accept-language',
  'accept-language': '\u0000accept-language',
  'X-Forwarded-For': '\u0000x-forwarded-for',
  'x-forwarded-for': '\u0000x-forwarded-for',
  'X-Forwarded-Host': '\u0000x-forwarded-host',
  'x-forwarded-host': '\u0000x-forwarded-host',
  'X-Forwarded-Proto': '\u0000x-forwarded-proto',
  'x-forwarded-proto': '\u0000x-forwarded-proto'
}
// if field flag is index 0, 1, or 2 they are handled uniquely
const specialHeaderFlagIdx = [true, true, true]
IncomingMessage.prototype._addHeaderLine = _addHeaderLine
function _addHeaderLine (field, value, dest) {
  field = known[field] || known[field = field.toLowerCase()] || `\u0000${field}`
  let flag = field.charCodeAt(0)
  if (!specialHeaderFlagIdx[flag]) {
    if (dest[field] === undefined) dest[field] = value
    return
  }
  if (flag === 0 || flag === 2) {
    field = field.slice(1)
    // Make a delimited list
    if (typeof dest[field] === 'string') {
      dest[field] += (flag === 0 ? ', ' : '; ') + value
    } else {
      dest[field] = value
    }
    return
  }
  // Array header -- only Set-Cookie at the moment
  if (dest['set-cookie'] !== undefined) {
    dest['set-cookie'].push(value)
  } else {
    dest['set-cookie'] = [value]
  }
}

const createServer = (listener) => new Server(listener)
module.exports = { createServer }
