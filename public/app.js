(() => {
  const locInput = document.getElementById("locInput");
  const kwInput = document.getElementById("kwInput");
  const suggestions = document.getElementById("suggestions");
  const runBtn = document.getElementById("runBtn");
  const statusEl = document.getElementById("status");
  const output = document.getElementById("output");
  const toggleLogs = document.getElementById("toggleLogs");
  const logsPanel = document.getElementById("logs");
  const serpRawEl = document.getElementById("serpRaw");
  const scrapedRawEl = document.getElementById("scrapedRaw");
  const cleanedRawEl = document.getElementById("cleanedRaw");

  let locTimer;

  locInput.addEventListener("input", () => {
    const q = locInput.value.trim();
    clearTimeout(locTimer);
    if (q.length < 2) {
      suggestions.innerHTML = "";
      return;
    }
    locTimer = setTimeout(fetchLocs, 300, q);
  });

  async function fetchLocs(q) {
    try {
      const r = await fetch(`/api/proxy-locations?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error("location lookup failed");
      const data = await r.json();
      suggestions.innerHTML = "";
      data.slice(0, 8).forEach(loc => {
        const display = (loc.canonical_name || loc.name || "").replace(/,/g, ", ");
        const li = document.createElement("li");
        li.textContent = display;
        li.style.padding = "10px 12px";
        li.style.cursor = "pointer";
        li.addEventListener("click", () => {
          locInput.value = display;
          suggestions.innerHTML = "";
        });
        suggestions.appendChild(li);
      });
    } catch (e) {
      suggestions.innerHTML = `<li style="color:red;padding:8px;">${e.message}</li>`;
    }
  }

  runBtn.addEventListener("click", async () => {
    const keyword = kwInput.value.trim();
    const location = locInput.value.trim();
    if (!keyword || !location) {
      alert("Need keyword and location");
      return;
    }
    statusEl.textContent = "Running search...";
    output.innerHTML = "";
    try {
      const resp = await fetch("/api/run-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: keyword, location }),
      });
      if (!resp.ok) {
        const err = await resp.json();
        statusEl.textContent = `Error: ${err.error || resp.status}`;
        return;
      }
      const data = await resp.json();
      statusEl.textContent = `Got ${data.results?.length || 0} results`;
      renderTable(data.results || []);
      serpRawEl.textContent = JSON.stringify(data.logs?.serp_raw, null, 2);
      scrapedRawEl.textContent = JSON.stringify(data.logs?.scraped_raw, null, 2);
      cleanedRawEl.textContent = JSON.stringify(data.logs?.cleaned, null, 2);
    } catch (e) {
      statusEl.textContent = "Fetch error";
      console.warn(e);
    }
  });

  function renderTable(rows) {
    if (!Array.isArray(rows)) return;
    const header = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="width:60px;">Rank</th>
              <th>Brand</th>
              <th>Permalink</th>
              <th>Title</th>
              <th>Meta</th>
              <th>H1</th>
              <th>Words</th>
              <th>Resp (ms)</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const brand = escapeHTML(r.brand || "");
                const permalink = r.permalink || r.finalUrl || "";
                return `
                <tr>
                  <td><div class="rank-badge">${r.rank || ""}</div></td>
                  <td>${brand}</td>
                  <td class="permalink"><a href="${permalink}" target="_blank" rel="noopener">${escapeHTML(permalink)}</a></td>
                  <td>${escapeHTML(r.title)}</td>
                  <td>${escapeHTML(r.metaDescription)}</td>
                  <td>${escapeHTML(r.h1)}</td>
                  <td>${r.wordCount || ""}</td>
                  <td>${r.responseTimeMs || ""}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
    output.innerHTML = header;
  }

  function escapeHTML(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  toggleLogs.addEventListener("click", () => {
    const active = logsPanel.classList.toggle("active");
    toggleLogs.textContent = active ? "Hide Logs" : "Show Logs";
  });

  // close suggestions if clicking outside
  document.addEventListener("click", (e) => {
    if (!locInput.contains(e.target) && !suggestions.contains(e.target)) {
      suggestions.innerHTML = "";
    }
  });
})();
