'use strict'

const { join } = require('path')
const ports = {http: 3010, httpLite: 3011}
const logStart = (n) => {
  let canSend = typeof process.send === 'function'
  if (canSend) process.send(n)
  let { heapUsed, heapTotal } = process.memoryUsage()
  if (canSend) process.send(`startMem${heapUsed}/${heapTotal}`)
}
process.on('message', (m) => {
  if (m === 'endMemory') {
    let { heapUsed, heapTotal } = process.memoryUsage()
    return process.send(`endMem${heapUsed}/${heapTotal}`)
  }
})
const benchId = 301
const start = {
  http: () => {
    const http = require('http')
    http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({data: `${benchId}`, error: null}))
    }).listen(ports.http, () => logStart('http'))
  },
  httpLite: () => {
    const http = require(join(__dirname, '..', 'index'))
    http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({data: `${benchId}`, error: null}))
    }).listen(ports.httpLite, () => logStart('httpLite'))
  }
}

start[process.argv[2]]()
