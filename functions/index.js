// START EXTRA EDGE functions
const { kvMirrorRetryWorker } = require('./kv/kvRetryWorker')
exports.kvMirrorRetryWorker = kvMirrorRetryWorker
exports.cms = require('./cms')
exports.history = require('./history')
exports.registration = require('./stagedUserNotifications')
exports.edgeMedia = require('./edgeMedia')
exports.siteWebAnalytics = require('./siteWebAnalytics')
exports.listAgentContractNotes = require('./cmsAgentContractNotes').listAgentContractNotes
exports.setAgentContractNote = require('./cmsAgentContractNotes').setAgentContractNote
exports.clearAgentContractNote = require('./cmsAgentContractNotes').clearAgentContractNote
// The one-time upload links of cms_upload_media (local files).
exports.cmsAgentMediaUpload = require('./cmsAgentMedia').agentMediaUpload
// END EXTRA EDGE functions
