'use strict'

// setup
import test from 'ava'
import axios from 'axios'
import httpMinimal from './index'
const benchId = 301
const port = 3123

test.skip(() => new Promise((resolve, reject) => {
  httpMinimal.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Benchmark', 'true')
    res.end(JSON.stringify({data: `${benchId}`, error: null}))
  }).listen(port, () => resolve())
}))

test.skip('setHeader works', async (assert) => {
  let { headers } = await axios(`http://localhost:${port}`)
  console.log(headers)
  assert.true(headers.benchmark)
})
