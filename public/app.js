/* global fetch, localStorage */
(() => {
  const $ = (id) => document.getElementById(id);

  /* DOM refs */
  const kwInput      = $("kwInput");
  const locInput     = $("locInput");
  const suggestions  = $("suggestions");
  const runBtn          = $("runBtn");
  const saveLoadBtn     = $("saveLoadBtn");
  const refreshBtn      = $("refreshBtn");
  const toggleListicles = $("toggleListicles");
  const exportBtn       = $("exportBtn");
  const statusEl        = $("status");
  const output          = $("output");

  /* state */
  let locTimer, lastResults = null, lastQuery = null, lastLoc = null;
  let showListicles = false;
  const SAVED_KEY = "serpSearchCache_v1";

  /* ───── autocomplete ───── */
  locInput.addEventListener("input", () => {
    const q = locInput.value.trim();
    clearTimeout(locTimer);
    if (q.length < 2) { suggestions.innerHTML = ""; return; }
    locTimer = setTimeout(fetchLocs, 300, q);
  });

  async function fetchLocs(q){
    try{
      const r = await fetch(`/api/proxy-locations?q=${encodeURIComponent(q)}`);
      if(!r.ok) throw new Error("Lookup failed");
      const data = await r.json();
      suggestions.innerHTML = "";
      data.slice(0,8).forEach(loc=>{
        const text = (loc.canonical_name || loc.name || "").replace(/,/g,", ");
        const li = document.createElement("li");
        li.className = "suggest-item";
        li.textContent = text;
        li.onclick = () => { locInput.value = text; suggestions.innerHTML=""; };
        suggestions.appendChild(li);
      });
    }catch(e){
      suggestions.innerHTML = `<li class="suggest-item" style="color:#f87171;">${e.message}</li>`;
    }
  }
  document.addEventListener("click",(e)=>{
    if(!locInput.contains(e.target)&&!suggestions.contains(e.target)){suggestions.innerHTML="";}
  });

  /* ───── run search ───── */
  runBtn.onclick = async()=>{
    const keyword=kwInput.value.trim(), location=locInput.value.trim();
    if(!keyword||!location){alert("Need keyword and location");return;}
    
    const startTime = Date.now();
    console.log(`🚀 Starting search: "${keyword}" in "${location}"`);
    statusEl.textContent="Running search…"; 
    output.innerHTML="<div style='padding: 20px; text-align: center; color: #666;'>🔍 Searching...</div>";
    
    try{
      console.log("📡 Connecting to /api/run-search-sse...");
      const url = `/api/run-search-sse?q=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}`;
      const es = new EventSource(url);
      const results = [];
      const startAt = Date.now();
      statusEl.textContent = "Fetching results…";
      output.innerHTML = renderSkeleton();

      es.addEventListener('result', (evt)=>{
        const row = JSON.parse(evt.data);
        // merge by rank
        const idx = results.findIndex(r=>r.rank===row.rank);
        if(idx>=0) results[idx] = { ...results[idx], ...row };
        else results.push(row);
        renderTable(results.sort((a,b)=>a.rank-b.rank));
      });

      es.addEventListener('done', (evt)=>{
        const info = JSON.parse(evt.data);
        const responseTime = Date.now()-startAt;
        statusEl.textContent = `Got ${info.successful} results (${info.blacklisted} filtered) in ${responseTime}ms`;
        lastResults = results.sort((a,b)=>a.rank-b.rank);
        saveLoadBtn.textContent="Save Search";
        exportBtn.style.display = lastResults.length? "inline-block":"none";
        es.close();
      });

      es.addEventListener('error', (evt)=>{
        console.error('SSE error', evt);
        statusEl.textContent = 'Stream error';
        es.close();
      });
      
      lastQuery=keyword; lastLoc=location;
      
    }catch(e){
      const elapsed = Date.now() - startTime;
      console.error(`❌ Fetch error after ${elapsed}ms:`, e);
      statusEl.textContent=`Fetch error (${elapsed}ms)`;
      output.innerHTML = `<div style='padding: 20px; color: #f87171;'>❌ Network error: ${e.message}</div>`;
    }
  };

  /* ───── save / load ───── */
  if(localStorage.getItem(SAVED_KEY)){saveLoadBtn.textContent="Load Search";}
  saveLoadBtn.onclick=()=>{
    if(saveLoadBtn.textContent.startsWith("Load")){
      try{
        const {keyword,location,results}=JSON.parse(localStorage.getItem(SAVED_KEY));
        kwInput.value=keyword; locInput.value=location; renderTable(results);
        statusEl.textContent=`Loaded ${results.length} cached results`;
        saveLoadBtn.textContent="Save Search";
      }catch{alert("No valid cached data");}
      return;
    }
    if(!lastResults){alert("Run a search first.");return;}
    localStorage.setItem(SAVED_KEY,JSON.stringify({keyword:lastQuery,location:lastLoc,results:lastResults}));
    statusEl.textContent="Search saved"; saveLoadBtn.textContent="Load Search";
  };

  /* ───── toggle listicles ───── */
  toggleListicles.onclick = () => {
    showListicles = !showListicles;
    if (lastResults) {
      renderTable(lastResults);
      const stats = lastResults.filter(r => r.isBlacklisted).length;
      toggleListicles.textContent = showListicles ? "Hide Listicles" : `Show Listicles (${stats})`;
    }
  };

  /* ───── CSV export ───── */
  exportBtn.onclick = () => {
    if (!lastResults || !lastQuery || !lastLoc) {
      alert("No search results to export");
      return;
    }

    console.log("📊 Exporting CSV...");
    
    // Choose which results to export based on current view
    const resultsToExport = showListicles ? lastResults : lastResults.filter(r => !r.isBlacklisted);
    
    // CSV headers
    const headers = [
      "Rank", "Brand", "URL", "Title", "Meta Description", "H1", 
      "Word Count", "Response Time (ms)", "Type", "Query", "Location"
    ];
    
    // Convert results to CSV rows
    const rows = resultsToExport.map(r => [
      r.rank || "",
      `"${(r.brand || "").replace(/"/g, '""')}"`,
      `"${(r.permalink || r.finalUrl || "").replace(/"/g, '""')}"`,
      `"${(r.title || "").replace(/"/g, '""')}"`,
      `"${(r.metaDescription || "").replace(/"/g, '""')}"`,
      `"${(r.h1 || "").replace(/"/g, '""')}"`,
      r.wordCount || "",
      r.responseTimeMs || "",
      r.isBlacklisted ? "Filtered" : "Competitor",
      `"${lastQuery.replace(/"/g, '""')}"`,
      `"${lastLoc.replace(/"/g, '""')}"`
    ]);
    
    // Combine headers and rows
    const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
    
    // Create and download file
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    
    const filename = `seo-analysis-${lastQuery.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    console.log(`✅ CSV exported: ${filename} (${resultsToExport.length} rows)`);
  };

  /* refresh */
  refreshBtn.onclick = ()=> location.reload();

  /* ───── renderer ───── */
  const esc = (s="")=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  
  // Delegate click handler for retrying timed-out rows
  document.addEventListener('click', async (e)=>{
    const tr = e.target.closest('tr');
    if(!tr || !output.contains(tr)) return;
    if(!(e.target.classList && e.target.classList.contains('retry-link'))) return;
    const idx = Array.from(tr.parentElement.children).indexOf(tr);
    const currentRows = showListicles ? lastResults : lastResults.filter(r=>!r.isBlacklisted);
    const row = currentRows[idx];
    if(!row || !row.permalink) return;
    
    try{
      statusEl.textContent = `Retrying ${row.brand}…`;
      const resp = await fetch('/api/retry-scrape', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: row.permalink || row.finalUrl })
      });
      const data = await resp.json();
      const r = data.result || {};
      if(!resp.ok || r.error){ throw new Error(r.error || `HTTP ${resp.status}`); }
      row.title = r.title || row.title;
      row.metaDescription = r.metaDescription || row.metaDescription;
      row.h1 = r.h1 || row.h1;
      row.wordCount = r.wordCount || row.wordCount;
      row.responseTimeMs = r.responseTimeMs || row.responseTimeMs;
      row.error = undefined;
      renderTable(lastResults);
      statusEl.textContent = `Retried ${row.brand}`;
    }catch(err){
      statusEl.textContent = `Retry failed: ${err.message}`;
      row.error = `Failed: ${err.message}`;
      renderTable(lastResults);
    }
  });
  function renderTable(rows){
    if(!Array.isArray(rows))return;
    
    // Filter rows based on toggle state
    const filteredRows = showListicles ? rows : rows.filter(r => !r.isBlacklisted);
    
    // Keep original SERP order; only annotate timed-out rows
    const finalRows = filteredRows.map(r=>({ ...r, timedOut: /Timeout/i.test(r.error||"") }));
    
    output.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="rank-col">Rank</th><th>Brand</th><th>Permalink</th>
              <th>Title</th><th>Meta</th><th>H1</th><th>Words</th><th>Resp (ms)</th>
            </tr>
          </thead><tbody>${
            finalRows.map(r=>`
              <tr${r.isBlacklisted ? ' class="blacklisted-row"' : ''}${r.error? ' class="row-failed"':''}>
                <td><div class="rank-badge">${r.rank||""}</div></td>
                <td>${esc(r.brand)}${r.error? ` <button class="retry-link" data-url="${r.permalink||r.finalUrl||''}">Retry</button>`:''}${r.timedOut? ' <span class="badge-timeout" title="Timed out. Click Retry to fetch again.">TIMED OUT</span>':''}</td>
                <td class="permalink"><a href="${r.permalink||r.finalUrl||""}" target="_blank" rel="noopener">${esc(r.permalink||r.finalUrl||"")}</a></td>
                <td>${esc(r.title)}</td>
                <td>${esc(r.metaDescription)}</td>
                <td>${esc(r.h1)}</td>
                <td>${r.wordCount||""}</td>
                <td>${r.responseTimeMs||""}</td>
              </tr>`).join("")
          }</tbody></table>
        ${finalRows.some(x=>x.error)? `<div class="retry-panel">Some sites timed out. Click the Retry button next to the brand to fetch again (30s max).</div>`:''}
      </div>`;
  }

  function renderSkeleton(){
    return `<div class="table-wrapper"><table><thead><tr>
      <th class="rank-col">Rank</th><th>Brand</th><th>Permalink</th>
      <th>Title</th><th>Meta</th><th>H1</th><th>Words</th><th>Resp (ms)</th>
    </tr></thead><tbody>
      ${Array.from({length:10}).map(()=>`<tr>
        <td><div class="rank-badge">…</div></td>
        <td><span class="skeleton-pill"></span></td>
        <td><span class="skeleton-pill wide"></span></td>
        <td><span class="skeleton-pill mid"></span></td>
        <td><span class="skeleton-pill mid"></span></td>
        <td><span class="skeleton-pill short"></span></td>
        <td><span class="skeleton-pill tiny"></span></td>
        <td><span class="skeleton-pill tiny"></span></td>
      </tr>`).join('')}
    </tbody></table></div>`;
  }
})();
