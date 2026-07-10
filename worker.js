// SKULL PW API - Cloudflare Worker
// Lightning Fast Video Key Extractor

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Routes
    if (path === '/') return html(getDocsHTML(), cors);
    if (path === '/admin') return html(getAdminHTML(), cors);
    if (path === '/api/get-keys') return handleGetKeys(env, cors);
    if (path === '/api/update-keys' && request.method === 'POST') return handleUpdateKeys(request, env, cors);

    // Main API: /batchId=X&childId=Y
    const batchId = url.searchParams.get('batchId') || path.match(/batchId=([^&]+)/)?.[1];
    const childId = url.searchParams.get('childId') || path.match(/childId=([^&]+)/)?.[1];

    if (batchId && childId) {
      return handleVideo(batchId, childId, env, cors);
    }

    return json({ success: false, error: 'Not Found' }, 404, cors);
  }
};

// ==================== MAIN HANDLER ====================

async function handleVideo(batchId, childId, env, cors) {
  const t = Date.now();

  try {
    // 6 requests simultaneously: DB keys + token + 4 video sources
    const [keysRes, tokenRes, ...vidRes] = await Promise.allSettled([
      getKeysFromDB(env),
      getToken(),
      src_studystark(batchId, childId),
      src_rolexcoderz(batchId, childId),
      src_sdvbots(batchId, childId),
      src_studytalk(batchId, childId),
    ]);

    // Keys from DB - agar DB fail to error
    if (keysRes.status !== 'fulfilled') {
      return json({ success: false, error: 'Failed to fetch keys from DB' }, 500, cors);
    }
    const keys = keysRes.value;

    // Token
    const token = tokenRes.status === 'fulfilled' ? tokenRes.value : '';

    // Find first working video URL
    let videoUrl = null;
    let source = null;
    const names = ['studystark', 'rolexcoderz', 'sdvbots', 'studytalk'];

    for (let i = 0; i < 4; i++) {
      if (vidRes[i].status === 'fulfilled' && vidRes[i].value) {
        let url = vidRes[i].value;

        // Decrypt studystark and studytalk
        if (i === 0) url = await decrypt(url, keys.studystark_key, keys.studystark_iv);
        if (i === 3) url = await decrypt(url, keys.studytalk_key, keys.studytalk_iv);

        if (url && url.includes('.mpd')) {
          videoUrl = url;
          source = names[i];
          break;
        }
      }
    }

    if (!videoUrl) {
      return json({ success: false, error: 'No video URL from any source', time: Date.now() - t }, 500, cors);
    }

    // Extract videoKey + KID simultaneously
    const [videoKey, kid] = await Promise.all([
      getVideoKey(videoUrl),
      getKID(videoUrl),
    ]);

    if (!videoKey) {
      return json({ success: false, error: 'Failed to extract videoKey', videoUrl, time: Date.now() - t }, 500, cors);
    }

    // Get clearKey
    const clearKey = await getClearKey(videoKey, token);

    return json({
      success: true,
      source,
      videoUrl,
      videoKey,
      kid: kid || 'N/A',
      clearKey: clearKey || 'N/A',
      time: Date.now() - t
    }, 200, cors);

  } catch (e) {
    return json({ success: false, error: e.message, time: Date.now() - t }, 500, cors);
  }
}

// ==================== 4 VIDEO SOURCES ====================

// 1. StudyStark - Encrypted, HTML page se extract karna hai
async function src_studystark(batchId, childId) {
  const resp = await fetch(
    `https://studystark.testwave.cc/play.php?batch_id=${batchId}&subject_id=IronSkullX&video_id=${childId}&video_type=new`,
    { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const html = await resp.text();
  return extractEncrypted(html);
}

// 2. RolexCoderZ - HTML page, videoData JSON se extract karo
async function src_rolexcoderz(batchId, childId) {
  const resp = await fetch(
    `https://rolexcoderz.com/RC/player/?batch_id=${batchId}&child_id=${childId}&subject_id=IronSkullX`,
    { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const html = await resp.text();

  // const videoData = {"video_url":"https://...mpd",...} se extract karo
  const m = html.match(/const\s+videoData\s*=\s*(\{[^}]+\})/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      if (data.video_url) return data.video_url;
    } catch {}
  }

  return extractMPD(html);
}

// 3. SDVBots - Direct JSON API, sabse simple
async function src_sdvbots(batchId, childId) {
  const resp = await fetch(
    `https://sdvbots.site/pw/api/get-video-url?batch_id=${batchId}&childId=${childId}`,
    { signal: AbortSignal.timeout(8000) }
  );
  const data = await resp.json();
  return data.success ? data.url : null;
}

// 4. StudyTalk - Encrypted, HTML page se extract karna hai
async function src_studytalk(batchId, childId) {
  const resp = await fetch(
    `https://stream.studytalk.cc/play.php?batch_id=${batchId}&subject_id=IronSkullX&video_id=${childId}&video_type=new`,
    { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const html = await resp.text();
  return extractEncrypted(html);
}

// ==================== TOKEN ====================

async function getToken() {
  const resp = await fetch('https://studystark.testwave.cc/token-proxy.php', {
    signal: AbortSignal.timeout(5000)
  });
  const data = await resp.json();
  return data.access_token || '';
}

// ==================== CLEARKEY ====================

async function getClearKey(videoKey, token) {
  const resp = await fetch(
    `https://skullpwapi.onrender.com/?videoKey=${videoKey}&auth=${token}`,
    { signal: AbortSignal.timeout(10000) }
  );
  const data = await resp.json();
  return data.success ? data.clearKey : null;
}

// ==================== HELPERS ====================

// HTML se encrypted payload extract karo
function extractEncrypted(html) {
  const patterns = [
    /['"]([A-Za-z0-9+/=]{100,})['"]/,
    /(?:payload|data|encrypted|url)['":\s]*['"]([A-Za-z0-9+/=]{20,})['"]/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

// HTML se MPD URL extract karo
function extractMPD(html) {
  const m = html.match(/https?:\/\/[^'"\s]+\.mpd[^'"\s]*/i);
  return m ? m[0] : null;
}

// Video URL se videoKey nikaalo (domain ke baad aur master.mpd ke beech ka path)
function getVideoKey(url) {
  const m = url.match(/\/\/[^\/]+\/([^?]+)\/master\.mpd/i);
  return m ? m[1] : null;
}

// MPD file se KID nikaalo
async function getKID(url) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const mpd = await resp.text();
    const m = mpd.match(/default_KID['"=:\s]*['"]*([a-f0-9-]+)/i) ||
             mpd.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    return m ? m[1].replace(/-/g, '') : null;
  } catch {
    return null;
  }
}

// AES-CBC Decrypt (Web Crypto API - Cloudflare compatible)
async function decrypt(data, keyHex, ivHex) {
  try {
    const key = await crypto.subtle.importKey(
      'raw', hex2buf(keyHex), { name: 'AES-CBC' }, false, ['decrypt']
    );
    
    // Try hex first, then base64
    let enc;
    try { enc = hex2buf(data); } catch { enc = b642buf(data); }
    
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: hex2buf(ivHex) }, key, enc
    );
    return new TextDecoder().decode(dec);
  } catch {
    return data;
  }
}

function hex2buf(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substr(i, 2), 16);
  return b;
}

function b642buf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ==================== DATABASE ====================

async function getKeysFromDB(env) {
  const { createClient } = await import('@libsql/client');
  const db = createClient({ url: env.TURSO_DB_URL, authToken: env.TURSO_DB_TOKEN });

  const result = await db.execute('SELECT key_name, key_value FROM api_keys');
  const keys = {};
  for (const row of result.rows) keys[row.key_name] = row.key_value;

  if (!keys.studystark_key || !keys.studystark_iv || !keys.studytalk_key || !keys.studytalk_iv) {
    throw new Error('Keys not found in DB. Run init-db.js first.');
  }

  return keys;
}

async function handleGetKeys(env, cors) {
  try {
    const keys = await getKeysFromDB(env);
    return json({ success: true, keys }, 200, cors);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, cors);
  }
}

async function handleUpdateKeys(req, env, cors) {
  try {
    const { key_name, key_value } = await req.json();
    const allowed = ['studystark_key', 'studystark_iv', 'studytalk_key', 'studytalk_iv'];

    if (!key_name || !key_value) return json({ success: false, error: 'key_name and key_value required' }, 400, cors);
    if (!allowed.includes(key_name)) return json({ success: false, error: 'Invalid key_name' }, 400, cors);

    const { createClient } = await import('@libsql/client');
    const db = createClient({ url: env.TURSO_DB_URL, authToken: env.TURSO_DB_TOKEN });
    await db.execute({
      sql: 'INSERT OR REPLACE INTO api_keys (key_name, key_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      args: [key_name, key_value]
    });

    return json({ success: true, message: `${key_name} updated` }, 200, cors);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, cors);
  }
}

// ==================== RESPONSE HELPERS ====================

function json(data, status, cors) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors }
  });
}

function html(content, cors) {
  return new Response(content, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', ...cors }
  });
}

// ==================== HTML PAGES ====================

function getDocsHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SKULL PW API</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0a0a0f;--s:#12121a;--b:#1e1e2e;--t:#e8e8f0;--m:#6c6c8a;--a:#8b5cf6;--a2:#06b6d4;--c:#1a1a2e}
    body{background:var(--bg);color:var(--t);font-family:Inter,-apple-system,sans-serif;line-height:1.6}
    .w{max-width:900px;margin:0 auto;padding:40px 20px}
    header{text-align:center;padding:60px 0 40px;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    h1{font-size:3rem;font-weight:800;letter-spacing:-1px}
    .sub{color:var(--m);font-size:1.1rem;margin-top:8px;-webkit-text-fill-color:unset}
    .bdg{display:inline-block;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;margin:20px 5px 0;-webkit-text-fill-color:unset}
    .bdg-p{background:rgba(139,92,246,.2);color:#a78bfa;border:1px solid rgba(139,92,246,.3)}
    .bdg-c{background:rgba(6,182,212,.2);color:#22d3ee;border:1px solid rgba(6,182,212,.3)}
    .sec{background:var(--s);border:1px solid var(--b);border-radius:16px;padding:32px;margin:24px 0}
    h2{font-size:1.5rem;margin-bottom:16px;display:flex;align-items:center;gap:10px}
    h2::before{content:'';width:4px;height:24px;background:linear-gradient(135deg,#8b5cf6,#06b6d4);border-radius:2px}
    h3{font-size:1.1rem;color:var(--a2);margin:20px 0 10px}
    p{color:var(--m);margin:10px 0}
    .ep{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:20px;margin:16px 0;font-family:monospace}
    .m-get{display:inline-block;padding:4px 10px;border-radius:6px;font-size:.8rem;font-weight:700;margin-right:10px;background:rgba(34,197,94,.2);color:#22c55e}
    .url{color:var(--t);font-size:.95rem}
    pre{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:20px;overflow-x:auto;margin:16px 0;font-family:monospace;font-size:.85rem;line-height:1.8}
    .jk{color:#a78bfa}.js{color:#22d3ee}.jn{color:#f59e0b}.jb{color:#22c55e}
    .fl{display:flex;align-items:center;gap:12px;padding:16px;background:rgba(139,92,246,.05);border-radius:12px;margin:16px 0;overflow-x:auto}
    .fs{background:var(--s);border:1px solid var(--b);padding:12px 16px;border-radius:8px;white-space:nowrap;font-size:.85rem}
    .fa{color:var(--a);font-size:1.2rem}
    .sc{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}
    .scc{background:var(--c);border:1px solid var(--b);border-radius:10px;padding:16px;text-align:center}
    .scc .n{font-weight:600;color:var(--a2)}.scc .ty{font-size:.8rem;color:var(--m);margin-top:4px}
    .btn{background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;border:none;padding:12px 24px;border-radius:10px;font-size:1rem;font-weight:600;cursor:pointer;margin:20px 0;transition:transform .2s,opacity .2s}
    .btn:hover{transform:translateY(-2px);opacity:.9}
    .ig{display:flex;gap:10px;margin:16px 0;flex-wrap:wrap}
    .ig input{flex:1;min-width:200px;padding:12px 16px;background:var(--c);border:1px solid var(--b);border-radius:10px;color:var(--t);font-size:.9rem}
    .ig input:focus{outline:none;border-color:var(--a)}
    #r{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:20px;margin:16px 0;font-family:monospace;font-size:.85rem;white-space:pre-wrap;display:none}
    footer{text-align:center;padding:40px 0;color:var(--m);font-size:.85rem}
  </style>
</head>
<body>
  <div class="w">
    <header>
      <h1>⚡ SKULL PW API</h1>
      <p class="sub">Lightning Fast Video Key Extraction API</p>
      <span class="bdg bdg-p">v2.0</span>
      <span class="bdg bdg-c">Cloudflare Workers</span>
    </header>
    <div class="sec">
      <h2>How It Works</h2>
      <p>Batch ID aur Child ID do, API 4 sources se simultaneously video URL fetch karegi, decrypt karegi, aur KID + ClearKey return karegi.</p>
      <div class="fl">
        <div class="fs">📤 Request</div><span class="fa">→</span>
        <div class="fs">🔑 Token + Keys</div><span class="fa">→</span>
        <div class="fs">🎬 4 Sources Race</div><span class="fa">→</span>
        <div class="fs">🔓 Decrypt</div><span class="fa">→</span>
        <div class="fs">📋 KID + videoKey</div><span class="fa">→</span>
        <div class="fs">🔐 ClearKey</div><span class="fa">→</span>
        <div class="fs">✅ Response</div>
      </div>
    </div>
    <div class="sec">
      <h2>Endpoint</h2>
      <h3>GET /batchId={batchId}&childId={childId}</h3>
      <div class="ep"><span class="m-get">GET</span><span class="url">/batchId=676e4dee1ec923bc192f38c9&childId=67fcb052fb1807f1d6e26bb6</span></div>
      <h3>Sources</h3>
      <div class="sc">
        <div class="scc"><div class="n">StudyStark</div><div class="ty">Encrypted (AES)</div></div>
        <div class="scc"><div class="n">RolexCoderZ</div><div class="ty">HTML Parse</div></div>
        <div class="scc"><div class="n">SDVBots</div><div class="ty">Direct JSON</div></div>
        <div class="scc"><div class="n">StudyTalk</div><div class="ty">Encrypted (AES)</div></div>
      </div>
    </div>
    <div class="sec">
      <h2>Try It</h2>
      <div class="ig">
        <input type="text" id="bid" placeholder="batchId" value="676e4dee1ec923bc192f38c9">
        <input type="text" id="cid" placeholder="childId" value="67fcb052fb1807f1d6e26bb6">
      </div>
      <button class="btn" onclick="go()">⚡ Fetch Keys</button>
      <div id="r"></div>
    </div>
    <div class="sec">
      <h2>Response</h2>
      <pre>{<span class="jk">"success"</span>: <span class="jb">true</span>, <span class="jk">"source"</span>: <span class="js">"sdvbots"</span>, <span class="jk">"videoUrl"</span>: <span class="js">"https://...master.mpd"</span>,
 <span class="jk">"videoKey"</span>: <span class="js">"uuid..."</span>, <span class="jk">"kid"</span>: <span class="js">"hex..."</span>, <span class="jk">"clearKey"</span>: <span class="js">"hex..."</span>,
 <span class="jk">"time"</span>: <span class="jn">245</span>}</pre>
    </div>
    <div class="sec">
      <h2>Admin</h2>
      <p>AES keys aur IVs manage karo.</p>
      <a href="/admin" style="display:inline-block;margin-top:10px;padding:10px 20px;background:var(--a);color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open Admin →</a>
    </div>
    <footer>Built with ⚡ by IronSkullX | Cloudflare Workers</footer>
  </div>
  <script>
    async function go(){
      const r=document.getElementById('r');r.style.display='block';r.textContent='⏳ Fetching...';
      try{const resp=await fetch('/batchId='+document.getElementById('bid').value+'&childId='+document.getElementById('cid').value);
      r.textContent=JSON.stringify(await resp.json(),null,2)}catch(e){r.textContent='Error: '+e.message}
    }
  </script>
</body>
</html>`;
}

function getAdminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SKULL Admin</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0a0a0f;--s:#12121a;--b:#1e1e2e;--t:#e8e8f0;--m:#6c6c8a;--a:#8b5cf6;--a2:#06b6d4}
    body{background:var(--bg);color:var(--t);font-family:Inter,-apple-system,sans-serif;min-height:100vh}
    .w{max-width:700px;margin:0 auto;padding:40px 20px}
    header{text-align:center;margin-bottom:40px}
    h1{font-size:2rem;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .sub{color:var(--m);margin-top:8px}
    .card{background:var(--s);border:1px solid var(--b);border-radius:16px;padding:28px;margin:20px 0}
    .card h2{font-size:1.2rem;margin-bottom:20px;display:flex;align-items:center;gap:10px}
    .fg{margin-bottom:20px}
    label{display:block;font-size:.85rem;color:var(--m);margin-bottom:8px;font-weight:500}
    input{width:100%;padding:12px 16px;background:var(--bg);border:1px solid var(--b);border-radius:10px;color:var(--t);font-family:monospace;font-size:.9rem}
    input:focus{outline:none;border-color:var(--a)}
    .btn{padding:12px 24px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;width:100%;background:linear-gradient(135deg,#8b5cf6,#06b6d4);color:#fff;transition:transform .2s}
    .btn:hover{transform:translateY(-1px)}
    .st{padding:12px 16px;border-radius:10px;margin-top:16px;font-size:.9rem;display:none}
    .st.ok{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:#22c55e;display:block}
    .st.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#ef4444;display:block}
    .bk{display:inline-flex;align-items:center;gap:6px;color:var(--a);text-decoration:none;font-size:.9rem;margin-bottom:20px}
    footer{text-align:center;padding:40px 0;color:var(--m);font-size:.8rem}
  </style>
</head>
<body>
  <div class="w">
    <a href="/" class="bk">← Back</a>
    <header><h1>⚙️ Admin Panel</h1><p class="sub">Manage AES Keys & IVs</p></header>
    <div class="card">
      <h2>⭐ StudyStark</h2>
      <div class="fg"><label>AES Key</label><input id="sk" placeholder="Key"></div>
      <div class="fg"><label>IV</label><input id="si" placeholder="IV"></div>
      <button class="btn" onclick="upd('studystark')">Save</button>
      <div id="ss" class="st"></div>
    </div>
    <div class="card">
      <h2>📚 StudyTalk</h2>
      <div class="fg"><label>AES Key</label><input id="tk" placeholder="Key"></div>
      <div class="fg"><label>IV</label><input id="ti" placeholder="IV"></div>
      <button class="btn" onclick="upd('studytalk')">Save</button>
      <div id="ts" class="st"></div>
    </div>
    <div class="card">
      <h2>🔄 Current Keys</h2>
      <button class="btn" onclick="load()" style="margin-bottom:16px">Refresh</button>
      <div id="ck" style="font-family:monospace;font-size:.85rem;white-space:pre-wrap;color:var(--m)">Click refresh...</div>
    </div>
    <footer>SKULL Admin</footer>
  </div>
  <script>
    window.onload=load;
    async function load(){
      const c=document.getElementById('ck');c.textContent='Loading...';
      try{const d=await(await fetch('/api/get-keys')).json();
      if(d.success){c.innerHTML='';
      for(const[n,v]of Object.entries(d.keys))c.innerHTML+='<div style="margin-bottom:8px"><b style="color:#06b6d4">'+n+':</b> '+v+'</div>';
      if(d.keys.studystark_key)document.getElementById('sk').value=d.keys.studystark_key;
      if(d.keys.studystark_iv)document.getElementById('si').value=d.keys.studystark_iv;
      if(d.keys.studytalk_key)document.getElementById('tk').value=d.keys.studytalk_key;
      if(d.keys.studytalk_iv)document.getElementById('ti').value=d.keys.studytalk_iv;
      }else c.textContent='Error: '+d.error}catch(e){c.textContent='Error: '+e.message}
    }
    async function upd(p){
      const ids=p==='studystark'?['sk','si']:['tk','ti'],s=document.getElementById(p==='studystark'?'ss':'ts');
      s.className='st';s.style.display='none';
      try{const[kr,ir]=await Promise.all([
        fetch('/api/update-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key_name:p+'_key',key_value:document.getElementById(ids[0]).value})}),
        fetch('/api/update-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key_name:p+'_iv',key_value:document.getElementById(ids[1]).value})})
      ]);const kd=await kr.json(),id=await ir.json();
      if(kd.success&&id.success){s.className='st ok';s.textContent='✅ Updated!'}else{s.className='st err';s.textContent='❌ '+(kd.error||id.error)}
      }catch(e){s.className='st err';s.textContent='❌ '+e.message}
    }
  </script>
</body>
</html>`;
}