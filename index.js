'use strict'

// imports and constant declarations
const util = require('util')
const net = require('net')
const { HTTPParser } = process.binding('http_parser')
const { OutgoingMessage } = require('_http_outgoing')
const { IncomingMessage } = require('_http_incoming')
const Buffer = require('buffer').Buffer
const assert = require('assert').ok
const {
  parsers,
  freeParser,
  CRLF,
  continueExpression,
  chunkExpression,
  httpSocketSetup,
  kIncomingMessage,
  _checkInvalidHeaderChar: checkInvalidHeaderChar
} = require('_http_common')
const { async_id_fields, constants: asyncConsts } = process.binding('async_wrap')
const { kAsyncIdCounter, kDefaultTriggerAsyncId } = asyncConsts
const kOnExecute = HTTPParser.kOnExecute | 0

// symbols
const outHeadersKey = Symbol('outHeadersKey')
const asyncIdSymbol = Symbol('asyncId')
const kServerResponse = Symbol('ServerResponse')

// async hook stuff from 'internal/async_hooks'
const newAsyncId = () => ++async_id_fields[kAsyncIdCounter]

const getOrSetAsyncId = (object) => {
  if (object.hasOwnProperty(asyncIdSymbol)) return object[asyncIdSymbol]
  return (object[asyncIdSymbol] = newAsyncId())
}

function defaultTriggerAsyncIdScope (triggerAsyncId, block, ...args) {
  const oldDefaultTriggerAsyncId = async_id_fields[kDefaultTriggerAsyncId]
  async_id_fields[kDefaultTriggerAsyncId] = triggerAsyncId

  let ret
  try {
    ret = Reflect.apply(block, null, args)
  } finally {
    async_id_fields[kDefaultTriggerAsyncId] = oldDefaultTriggerAsyncId
  }
  return ret
}

const STATUS_CODES = {
  100: 'Continue',
  101: 'Switching Protocols',
  102: 'Processing',                 // RFC 2518, obsoleted by RFC 4918
  103: 'Early Hints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'Non-Authoritative Information',
  204: 'No Content',
  205: 'Reset Content',
  206: 'Partial Content',
  207: 'Multi-Status',               // RFC 4918
  208: 'Already Reported',
  226: 'IM Used',
  300: 'Multiple Choices',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  305: 'Use Proxy',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',         // RFC 7238
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  407: 'Proxy Authentication Required',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  416: 'Range Not Satisfiable',
  417: 'Expectation Failed',
  418: 'I\'m a teapot',              // RFC 2324
  421: 'Misdirected Request',
  422: 'Unprocessable Entity',       // RFC 4918
  423: 'Locked',                     // RFC 4918
  424: 'Failed Dependency',          // RFC 4918
  425: 'Unordered Collection',       // RFC 4918
  426: 'Upgrade Required',           // RFC 2817
  428: 'Precondition Required',      // RFC 6585
  429: 'Too Many Requests',          // RFC 6585
  431: 'Request Header Fields Too Large', // RFC 6585
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
  505: 'HTTP Version Not Supported',
  506: 'Variant Also Negotiates',    // RFC 2295
  507: 'Insufficient Storage',       // RFC 4918
  508: 'Loop Detected',
  509: 'Bandwidth Limit Exceeded',
  510: 'Not Extended',               // RFC 2774
  511: 'Network Authentication Required' // RFC 6585
}

function ServerResponse (req) {
  OutgoingMessage.call(this)
  if (req.method === 'HEAD') this._hasBody = false
  this.sendDate = true
  this._sent100 = false
  this._expect_continue = false
  if (req.httpVersionMajor < 1 || req.httpVersionMinor < 1) {
    this.useChunkedEncodingByDefault = chunkExpression.test(req.headers.te)
    this.shouldKeepAlive = false
  }
}
util.inherits(ServerResponse, OutgoingMessage)

ServerResponse.prototype._finish = function _finish () {
  OutgoingMessage.prototype._finish.call(this)
}

ServerResponse.prototype.statusCode = 200
ServerResponse.prototype.statusMessage = undefined

function onServerResponseClose () {
  if (this._httpMessage) this._httpMessage.emit('close')
}

ServerResponse.prototype.assignSocket = function assignSocket (socket) {
  assert(!socket._httpMessage)
  socket._httpMessage = this
  socket.on('close', onServerResponseClose)
  this.socket = socket
  this.connection = socket
  this.emit('socket', socket)
  this._flush()
}

ServerResponse.prototype.detachSocket = function detachSocket (socket) {
  assert(socket._httpMessage === this)
  socket.removeListener('close', onServerResponseClose)
  socket._httpMessage = null
  this.socket = this.connection = null
}

ServerResponse.prototype.writeContinue = function writeContinue (cb) {
  this._writeRaw(`HTTP/1.1 100 Continue${CRLF}${CRLF}`, 'ascii', cb)
  this._sent100 = true
}

ServerResponse.prototype.writeProcessing = function writeProcessing (cb) {
  this._writeRaw(`HTTP/1.1 102 Processing${CRLF}${CRLF}`, 'ascii', cb)
}

ServerResponse.prototype._implicitHeader = function _implicitHeader () {
  this.writeHead(this.statusCode)
}

ServerResponse.prototype.writeHead = writeHead
function writeHead (statusCode, reason, obj) {
  let originalStatusCode = statusCode
  let code = statusCode |= 0

  if (code < 100 || code > 999) {
    throw new RangeError('ERR_HTTP_INVALID_STATUS_CODE', originalStatusCode)
  }

  let reasonIsString = typeof reason === 'string'
  this.statusMessage = !reasonIsString
    ? (this.statusMessage || STATUS_CODES[code] || 'unknown')
    : reason
  if (!reasonIsString) obj = reason
  this.statusCode = code

  let headers
  if (this[outHeadersKey]) {
    // Slow-case: when progressive API and header fields are passed.
    let k
    if (obj) {
      let keys = Object.keys(obj)
      for (let i = 0; i < keys.length; i++) {
        k = keys[i]
        if (k) this.setHeader(k, obj[k])
      }
    }
    if (k === undefined && this._header) {
      throw new Error('ERR_HTTP_HEADERS_SENT', 'render')
    }
    // only progressive api is used
    headers = this[outHeadersKey]
  } else {
    // only writeHead() called
    headers = obj
  }

  if (checkInvalidHeaderChar(this.statusMessage)) {
    throw new Error('ERR_INVALID_CHAR', 'statusMessage')
  }

  let statusLine = `HTTP/1.1 ${code} ${this.statusMessage}${CRLF}`
  if (code === 204 || code === 304 || (code >= 100 && code <= 199)) {
    this._hasBody = false
  }

  // don't keep alive connections where the client expects 100 Continue
  // but we sent a final status; they may put extra bytes on the wire.
  if (this._expect_continue && !this._sent100) this.shouldKeepAlive = false

  this._storeHeader(statusLine, headers)
}

// Docs-only deprecated: DEP0063
ServerResponse.prototype.writeHeader = ServerResponse.prototype.writeHead

function Server (options, requestListener) {
  if (!(this instanceof Server)) return new Server(options, requestListener)

  let optionsType = typeof options
  if (optionsType === 'function') {
    requestListener = options
    options = {}
  } else if (options == null || optionsType === 'object') {
    options = Object.assign({}, options)
  }

  this[kIncomingMessage] = options.IncomingMessage || IncomingMessage
  this[kServerResponse] = options.ServerResponse || ServerResponse

  net.Server.call(this, { allowHalfOpen: true })

  if (requestListener) this.on('request', requestListener)

  this.httpAllowHalfOpen = false

  this.on('connection', connectionListener)

  this.timeout = 2 * 60 * 1000
  this.keepAliveTimeout = 5000
  this._pendingResponseData = 0
  this.maxHeadersCount = null
}
util.inherits(Server, net.Server)

Server.prototype.setTimeout = function setTimeout (msecs, callback) {
  this.timeout = msecs
  if (callback) { this.on('timeout', callback) }
  return this
}

function connectionListener (socket) {
  defaultTriggerAsyncIdScope(
    getOrSetAsyncId(socket), connectionListenerInternal, this, socket
  )
}

function connectionListenerInternal (server, socket) {
  httpSocketSetup(socket)
  if (socket.server === null) socket.server = server

  if (server.timeout && typeof socket.setTimeout === 'function') {
    socket.setTimeout(server.timeout)
  }
  socket.on('timeout', socketOnTimeout)

  let parser = parsers.alloc()
  parser.reinitialize(HTTPParser.REQUEST)
  parser.socket = socket
  socket.parser = parser
  parser.incoming = null

  if (typeof server.maxHeadersCount === 'number') {
    parser.maxHeaderPairs = server.maxHeadersCount << 1
  } else {
    parser.maxHeaderPairs = 2000
  }

  let state = {
    onData: null,
    onEnd: null,
    onClose: null,
    onDrain: null,
    outgoing: [],
    incoming: [],
    outgoingData: 0,
    keepAliveTimeoutSet: false
  }
  state.onData = socketOnData.bind(undefined, server, socket, parser, state)
  state.onEnd = socketOnEnd.bind(undefined, server, socket, parser, state)
  state.onClose = socketOnClose.bind(undefined, socket, state)
  state.onDrain = socketOnDrain.bind(undefined, socket, state)
  socket.on('data', state.onData)
  socket.on('error', socketOnError)
  socket.on('end', state.onEnd)
  socket.on('close', state.onClose)
  socket.on('drain', state.onDrain)
  parser.onIncoming = parserOnIncoming.bind(undefined, server, socket, state)

  // We are consuming socket, so it won't get any actual data
  socket.on('resume', onSocketResume)
  socket.on('pause', onSocketPause)

  // Override on to unconsume on `data`, `readable` listeners
  socket.on = socketOnWrap

  // We only consume the socket if it has never been consumed before.
  if (socket._handle) {
    let external = socket._handle._externalStream
    if (!socket._handle._consumed && external) {
      parser._consumed = true
      socket._handle._consumed = true
      parser.consume(external)
    }
  }
  parser[kOnExecute] =
    onParserExecute.bind(undefined, server, socket, parser, state)

  socket._paused = false
}

function updateOutgoingData (socket, state, delta) {
  state.outgoingData += delta
  if (socket._paused && state.outgoingData < socket.writableHighWaterMark) {
    return socketOnDrain(socket, state)
  }
}

function socketOnDrain (socket, state) {
  let needPause = state.outgoingData > socket.writableHighWaterMark

  if (socket._paused && !needPause) {
    socket._paused = false
    if (socket.parser) socket.parser.resume()
    socket.resume()
  }
}

function ondrain () { if (this._httpMessage) this._httpMessage.emit('drain') }

function socketOnTimeout () {
  let req = this.parser && this.parser.incoming
  let reqTimeout = req && !req.complete && req.emit('timeout', this)
  let res = this._httpMessage
  let resTimeout = res && res.emit('timeout', this)
  let serverTimeout = this.server.emit('timeout', this)

  if (!reqTimeout && !resTimeout && !serverTimeout) this.destroy()
}

function socketOnClose (socket, state) {
  if (socket.parser) freeParser(socket.parser, null, socket)
  abortIncoming(state.incoming)
}

function abortIncoming (incoming) {
  while (incoming.length) {
    let req = incoming.shift()
    req.emit('aborted')
    req.emit('close')
  }
}

function socketOnEnd (server, socket, parser, state) {
  let ret = parser.finish()

  if (ret instanceof Error) return socketOnError.call(socket, ret)

  if (!server.httpAllowHalfOpen) {
    abortIncoming(state.incoming)
    if (socket.writable) socket.end()
  } else if (state.outgoing.length) {
    state.outgoing[state.outgoing.length - 1]._last = true
  } else if (socket._httpMessage) {
    socket._httpMessage._last = true
  } else if (socket.writable) {
    socket.end()
  }
}

function socketOnData (server, socket, parser, state, d) {
  assert(!socket._paused)
  let ret = parser.execute(d)
  onParserExecuteCommon(server, socket, parser, state, ret, d)
}

function onParserExecute (server, socket, parser, state, ret) {
  socket._unrefTimer()
  onParserExecuteCommon(server, socket, parser, state, ret, undefined)
}

const badRequestResponse = Buffer.from(
  `HTTP/1.1 400 ${STATUS_CODES[400]}${CRLF}${CRLF}`, 'ascii'
)
function socketOnError (e) {
  this.removeListener('error', socketOnError)
  this.on('error', () => {})

  if (!this.server.emit('clientError', e, this)) {
    if (this.writable) return this.end(badRequestResponse)
    this.destroy(e)
  }
}

function onParserExecuteCommon (server, socket, parser, state, ret, d) {
  resetSocketTimeout(server, socket, state)

  if (ret instanceof Error) {
    ret.rawPacket = d || parser.getCurrentBuffer()
    socketOnError.call(socket, ret)
  } else if (parser.incoming && parser.incoming.upgrade) {
    // Upgrade or CONNECT
    let bytesParsed = ret
    let req = parser.incoming

    if (!d) d = parser.getCurrentBuffer()

    socket.removeListener('data', state.onData)
    socket.removeListener('end', state.onEnd)
    socket.removeListener('close', state.onClose)
    socket.removeListener('drain', state.onDrain)
    socket.removeListener('drain', ondrain)
    socket.removeListener('error', socketOnError)
    unconsume(parser, socket)
    parser.finish()
    freeParser(parser, req, null)
    parser = null

    let eventName = req.method === 'CONNECT' ? 'connect' : 'upgrade'
    if (server.listenerCount(eventName) > 0) {
      let bodyHead = d.slice(bytesParsed, d.length)
      socket.readableFlowing = null
      server.emit(eventName, req, socket, bodyHead)
    } else {
      socket.destroy()
    }
  }

  if (socket._paused && socket.parser) socket.parser.pause()
}

function resOnFinish (req, res, socket, state, server) {
  assert(state.incoming.length === 0 || state.incoming[0] === req)
  state.incoming.shift()

  if (!req._consuming && !req._readableState.resumeScheduled) req._dump()

  res.detachSocket(socket)

  if (res._last) {
    let ender = typeof socket.destroySoon === 'function' ? 'destroySoon' : 'end'
    socket[ender]()
  } else if (state.outgoing.length === 0) {
    if (server.keepAliveTimeout && typeof socket.setTimeout === 'function') {
      socket.setTimeout(0)
      socket.setTimeout(server.keepAliveTimeout)
      state.keepAliveTimeoutSet = true
    }
  } else {
    let m = state.outgoing.shift()
    if (m) m.assignSocket(socket)
  }
}

function parserOnIncoming (server, socket, state, req, keepAlive) {
  resetSocketTimeout(server, socket, state)
  state.incoming.push(req)

  if (!socket._paused) {
    let ws = socket._writableState
    if (ws.needDrain || state.outgoingData >= socket.writableHighWaterMark) {
      socket._paused = true
      socket.pause()
    }
  }

  let res = new server[kServerResponse](req)
  res._onPendingData = updateOutgoingData.bind(undefined, socket, state)
  res.shouldKeepAlive = keepAlive

  socket._httpMessage ? state.outgoing.push(res) : res.assignSocket(socket)

  res.on('finish', resOnFinish.bind(undefined, req, res, socket, state, server))

  let isHttpOneOne = req.httpVersionMajor === 1 && req.httpVersionMinor === 1
  if (req.headers.expect === undefined || !isHttpOneOne) {
    server.emit('request', req, res)
    return 0
  }
  if (continueExpression.test(req.headers.expect)) {
    res._expect_continue = true

    if (server.listenerCount('checkContinue') > 0) {
      server.emit('checkContinue', req, res)
    } else {
      res.writeContinue()
      server.emit('request', req, res)
    }
  } else if (server.listenerCount('checkExpectation') > 0) {
    server.emit('checkExpectation', req, res)
  } else {
    res.writeHead(417)
    res.end()
  }
  return 0  // No special treatment.
}

function resetSocketTimeout (server, socket, state) {
  if (!state.keepAliveTimeoutSet) return
  socket.setTimeout(server.timeout || 0)
  state.keepAliveTimeoutSet = false
}

function onSocketResume () {
  if (this._paused) return this.pause()
  if (this._handle && !this._handle.reading) {
    this._handle.reading = true
    this._handle.readStart()
  }
}

function onSocketPause () {
  if (this._handle && this._handle.reading) {
    this._handle.reading = false
    this._handle.readStop()
  }
}

function unconsume (parser, socket) {
  if (!socket._handle) return
  if (parser._consumed) parser.unconsume()
  parser._consumed = false
  socket.removeListener('pause', onSocketPause)
  socket.removeListener('resume', onSocketResume)
}

function socketOnWrap (ev, fn) {
  let res = net.Socket.prototype.on.call(this, ev, fn)
  if (!this.parser) {
    this.on = net.Socket.prototype.on
    return res
  }
  if (ev === 'data' || ev === 'readable') unconsume(this.parser, this)
  return res
}

module.exports.createServer = (requestListener) => new Server(requestListener)
