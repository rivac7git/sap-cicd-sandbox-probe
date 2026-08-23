// Authorized sandbox-boundary recon for SAP's Bugcrowd "Continuous Integration and Delivery"
// program (sap-og24). Runs as an npm postinstall hook during the pipeline's Build stage — this
// is our OWN pipeline execution, code execution here is explicitly acknowledged as normal by
// the program brief ("Code execution during a pipeline run is inherent to a CI/CD service").
//
// What this checks (all read-only, no writes/mutations, no credential exfiltration, no broad
// scanning — a handful of single-connection reachability checks against well-known internal
// service endpoints, staying within the brief's "reasonable number of connections" rule):
//   1. Are we in a container? What container runtime clues are visible?
//   2. Is a Kubernetes service account token mounted, and if so, is its access scoped to just
//      this pod's own namespace, or does it reach further (the actual tenant-isolation question)?
//   3. Is the cloud-provider metadata endpoint (169.254.169.254) reachable from here?
//   4. Any signs of a shared filesystem holding data outside this build's own workspace?
//
// Everything below only READS and reports — nothing is modified, deleted, or exfiltrated
// anywhere. Output goes to this build's own log, which only this account can see.

const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

function safeRead(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch (e) { return null; }
}

function safeReadDir(path) {
  try { return fs.readdirSync(path); } catch (e) { return null; }
}

function timedGet(url, headers, timeoutMs) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: headers || {}, timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 2000) body += c; });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, body: body.slice(0, 2000) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

async function main() {
  section('1. Container / runtime indicators');
  console.log('hostname:', os.hostname());
  console.log('platform:', os.platform(), os.release());
  console.log('cgroup (first 500 chars):', (safeRead('/proc/1/cgroup') || 'not readable').slice(0, 500));
  console.log('/.dockerenv exists:', fs.existsSync('/.dockerenv'));
  console.log('CF env hints:', {
    VCAP_APPLICATION: !!process.env.VCAP_APPLICATION,
    VCAP_SERVICES: !!process.env.VCAP_SERVICES,
    CF_INSTANCE_GUID: process.env.CF_INSTANCE_GUID || null,
    CF_INSTANCE_INDEX: process.env.CF_INSTANCE_INDEX || null,
  });

  section('2. Kubernetes service account token presence + scope check');
  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const nsPath = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';
  const token = safeRead(tokenPath);
  console.log('K8s service account token mounted:', !!token, token ? `(length ${token.length})` : '');
  console.log('K8s namespace file:', safeRead(nsPath) || 'not present');
  if (token) {
    // Single read-only call to the API server root — lists nothing sensitive, just confirms
    // reachability and what the token's own namespace scope looks like via a 403 vs 200 diff.
    const apiHost = process.env.KUBERNETES_SERVICE_HOST;
    const apiPort = process.env.KUBERNETES_SERVICE_PORT || '443';
    if (apiHost) {
      const ownNsResult = await timedGet(`https://${apiHost}:${apiPort}/api/v1/namespaces`, { Authorization: 'Bearer ' + token.trim() }, 4000);
      console.log('GET /api/v1/namespaces (lists all namespace NAMES only, no data) ->', ownNsResult.ok ? ownNsResult.status : ownNsResult.error);
      if (ownNsResult.ok) console.log('  body (first 800 chars):', ownNsResult.body.slice(0, 800));
    } else {
      console.log('KUBERNETES_SERVICE_HOST not set — likely not running inside a live K8s pod network context.');
    }
  }

  section('3. Cloud metadata endpoint reachability (169.254.169.254)');
  const metaResult = await timedGet('http://169.254.169.254/', {}, 2500);
  console.log('GET http://169.254.169.254/ ->', metaResult.ok ? metaResult.status : metaResult.error);
  if (metaResult.ok) console.log('  body (first 500 chars):', metaResult.body.slice(0, 500));

  section('4. Filesystem — anything beyond our own workspace');
  console.log('cwd:', process.cwd());
  console.log('/ contents:', safeReadDir('/'));
  console.log('/home contents:', safeReadDir('/home'));
  console.log('/tmp contents (top-level only):', safeReadDir('/tmp'));

  section('Done — read-only recon complete, nothing modified');
}

main().catch((e) => console.log('probe error (non-fatal):', e.message));
