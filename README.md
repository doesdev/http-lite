# http-minimal [![NPM version](https://badge.fury.io/js/http-minimal.svg)](https://npmjs.org/package/http-minimal)   [![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)   [![Dependency Status](https://dependencyci.com/github/doesdev/http-minimal/badge)](https://dependencyci.com/github/doesdev/http-minimal)

> A minimalistic take on Node's `http` module

Right now this is copy paste of the built-in http lib, with some extremely minor
changes. There's no compelling reason to use this over the standard lib. That
being said, the plan is to step through all of the included libs and remove
features and compatibility stuff to get to an absolute minimal of features for
my own needs. It's more an exercise than anything.

At present it is up to date with commit #51be03c on master. The only changes are
removal of debug calls, a few tiny semantic tweaks (changes in if order sort of
stuff), and using `standard-js`. In the included benchmarks it does run
consistently more reqs/sec though not much. Last bench I ran was 49k over 46k.

Such minor gains are worthless unmatched with the tests, community and ongoing
development of the standard library. So just don't use this. If I find any
transformative gains in this exercise I'll certainly point them upstream.

# license

MIT © [Andrew Carpenter](https://github.com/doesdev)
