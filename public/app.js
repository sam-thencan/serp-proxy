/* global fetch, localStorage */
(() => {
  const $ = (id) => document.getElementById(id);

  /* DOM refs */
  const kwInput      = $("kwInput");
  const locInput     = $("locInput");
  const suggestions  = $("suggestions");
  const runBtn       = $("runBtn");
  const saveLoadBtn  = $("saveLoadBtn");
  const refreshBtn   = $("refreshBtn");
  const statusEl     = $("status");
  const output       = $("output");

  /* state */
  let locTimer, lastResults = null, lastQuery = null, lastLoc = null;
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
    statusEl.textContent="Running search…"; output.innerHTML="";
    try{
      const resp=await fetch("/api/run-search",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({q:keyword,location})});
      if(!resp.ok){const err=await resp.json();statusEl.textContent=`Error: ${err.error||resp.status}`;return;}
      const data=await resp.json();
      statusEl.textContent=`Got ${data.results?.length||0} results`;
      renderTable(data.results||[]);
      lastResults=data.results||[]; lastQuery=keyword; lastLoc=location;
      saveLoadBtn.textContent="Save Search";
    }catch(e){statusEl.textContent="Fetch error";console.warn(e);}
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

  /* refresh */
  refreshBtn.onclick = ()=> location.reload();

  /* ───── renderer ───── */
  const esc = (s="")=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  function renderTable(rows){
    if(!Array.isArray(rows))return;
    output.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="rank-col">Rank</th><th>Brand</th><th>Permalink</th>
              <th>Title</th><th>Meta</th><th>H1</th><th>Words</th><th>Resp (ms)</th>
            </tr>
          </thead><tbody>${
            rows.map(r=>`
              <tr>
                <td><div class="rank-badge">${r.rank||""}</div></td>
                <td>${esc(r.brand)}</td>
                <td class="permalink"><a href="${r.permalink||r.finalUrl||""}" target="_blank" rel="noopener">${esc(r.permalink||r.finalUrl||"")}</a></td>
                <td>${esc(r.title)}</td>
                <td>${esc(r.metaDescription)}</td>
                <td>${esc(r.h1)}</td>
                <td>${r.wordCount||""}</td>
                <td>${r.responseTimeMs||""}</td>
              </tr>`).join("")
          }</tbody></table>
      </div>`;
  }
})();
