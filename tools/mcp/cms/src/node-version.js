// Imported first by server.js. The write, preview and readiness tools use the
// built-in fetch, and firebase-admin needs a current Node; an MCP client that
// starts the server with an old default Node (a shell's nvm default of 16)
// otherwise fails later with "fetchImpl is not a function".
const REQUIRED_MAJOR = 22
const major = Number(process.versions.node.split('.')[0])
if (major < REQUIRED_MAJOR) {
  console.error(`edge-cms-mcp needs Node ${REQUIRED_MAJOR} or newer; this is Node ${process.versions.node} (${process.execPath}). Start it with the Node in the Hub's .nvmrc (see the MCP README, "Node version").`)
  process.exit(1)
}
