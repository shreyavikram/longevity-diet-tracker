// Cloud backup in a private GitHub repository, through the GitHub contents API.
// tracker.json holds the full export (never API keys or the token), inbox/*.json holds entries added from
// elsewhere (for example by Claude) that the app applies once and removes, and activity.json holds workouts.
// The phone stays the source of truth: the cloud copy only restores a device that has no history yet.
const API = 'https://api.github.com';

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

class CloudError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Exports carry a fresh exportedAt each time; compare without it so unchanged history is not re-uploaded.
function comparable(text) {
  try {
    const payload = JSON.parse(text);
    delete payload.exportedAt;
    return JSON.stringify(payload);
  } catch {
    return text;
  }
}

export function createCloudSync({ getConfig, exportData, hasHistory, importData, applyInboxEntry, applyActivity,
  fetchFn = globalThis.fetch, onStatus = () => {}, now = () => new Date() }) {
  let lastPushed = null;
  let running = Promise.resolve();

  const config = () => {
    const { token = '', repo = '' } = getConfig() ?? {};
    return { token: String(token).trim(), repo: String(repo).trim() };
  };
  const configured = () => {
    const { token, repo } = config();
    return Boolean(token) && /^[\w.-]+\/[\w.-]+$/.test(repo);
  };

  async function request(method, path, { accept = 'application/vnd.github+json', body } = {}) {
    const { token, repo } = config();
    const response = await fetchFn(`${API}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw new CloudError(response.status, 'GitHub rejected the token. Check it in Settings.');
    if (!response.ok) throw new CloudError(response.status, `GitHub returned ${response.status}.`);
    return response;
  }

  const getText = async path => (await request('GET', path, { accept: 'application/vnd.github.raw+json' }))?.text() ?? null;
  const getSha = async path => (await (await request('GET', path))?.json())?.sha ?? null;

  async function push() {
    const text = exportData();
    const current = comparable(text);
    if (current === lastPushed) return false;
    const write = async () => {
      const sha = await getSha('tracker.json');
      const response = await request('PUT', 'tracker.json', { body: {
        message: `Back up tracker ${now().toISOString()}`, content: encodeBase64(text), ...(sha ? { sha } : {}) } });
      if (!response) throw new CloudError(404, 'GitHub could not find the backup repository. Check its name in Settings.');
    };
    try {
      await write();
    } catch (error) {
      if (error.status !== 409) throw error;
      await write();
    }
    lastPushed = current;
    return true;
  }

  async function restoreIfEmpty() {
    if (hasHistory()) return false;
    const text = await getText('tracker.json');
    if (!text) return false;
    importData(text);
    lastPushed = comparable(exportData());
    return true;
  }

  async function readInbox() {
    const listing = await request('GET', 'inbox');
    const files = listing ? (await listing.json()).filter(file => file.type === 'file' && file.name.endsWith('.json')) : [];
    let applied = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const entry = JSON.parse(await getText(file.path));
        if (entry?.version !== 1) throw new Error('Unsupported inbox entry');
        applyInboxEntry(entry);
        await request('DELETE', file.path, { body: { message: `Applied ${file.name}`, sha: file.sha } });
        applied += 1;
      } catch (error) {
        if (error instanceof CloudError) throw error;
        failed += 1;
      }
    }
    return { applied, failed };
  }

  async function readActivity() {
    const text = await getText('activity.json');
    if (!text) return;
    try { applyActivity(JSON.parse(text)); } catch { /* A malformed workout file is ignored; the next sync retries. */ }
  }

  function describe(error) {
    if (error instanceof CloudError) return error.message;
    return 'Cloud backup is waiting for a connection.';
  }

  function queue(task) {
    running = running.then(task, task);
    return running;
  }

  async function syncNow() {
    if (!configured()) return;
    return queue(async () => {
      try {
        const restored = await restoreIfEmpty();
        const { applied, failed } = await readInbox();
        await readActivity();
        await push();
        const parts = [`Backed up ${now().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`];
        if (restored) parts.push('History restored from the cloud.');
        if (applied) parts.push(`${applied} ${applied === 1 ? 'entry was' : 'entries were'} added from the inbox.`);
        if (failed) parts.push(`${failed} ${failed === 1 ? 'entry' : 'entries'} could not be read and stayed in the inbox.`);
        onStatus(parts.join(' '), { ok: true, restored, applied });
      } catch (error) {
        onStatus(describe(error), { ok: false });
      }
    });
  }

  async function pushNow() {
    if (!configured()) return;
    return queue(async () => {
      try {
        if (await push()) onStatus(`Backed up ${now().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`, { ok: true });
      } catch (error) {
        onStatus(describe(error), { ok: false });
      }
    });
  }

  return { configured, syncNow, push: pushNow };
}
