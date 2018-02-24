# http-minimal [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)   [![Dependency Status](https://dependencyci.com/github/doesdev/http-minimal/badge)](https://dependencyci.com/github/doesdev/http-minimal)

> A minimalistic take on Node's `http` module

## Nope, unable to get any real gains in js land

This module is primarily an exercise to see if there are any gains to be had in
js land with the current built in `http` server stuff. I suppose that would be
best done in node source, but for now I'm just patching stuff here. If I find
anything useful I'll upstream it. So far it consistently benches a hair higher
(~ +1kreq.sec). Not really enough to upstream though.

Such minor gains are worthless unmatched with the tests, community and ongoing
development of the standard library. So just don't use this. If I find any
real gains in this exercise I'll certainly point them upstream.

# license

MIT © [Andrew Carpenter](https://github.com/doesdev)
