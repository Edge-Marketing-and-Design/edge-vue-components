// START EXTRA EDGE functions
const { kvMirrorRetryWorker } = require('./kv/kvRetryWorker')
exports.kvMirrorRetryWorker = kvMirrorRetryWorker
exports.cms = require('./cms')
exports.history = require('./history')
exports.registration = require('./stagedUserNotifications')
exports.edgeMedia = require('./edgeMedia')
exports.siteWebAnalytics = require('./siteWebAnalytics')
// END EXTRA EDGE functions
