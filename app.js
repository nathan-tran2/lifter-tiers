(function () {
  "use strict";

  // ---------- constants ----------
  var CFG = window.TIER_CONFIG || {};
  var TIERS = [
    { k: "S", kg: 25, name: "The holy grail" },
    { k: "A", kg: 20, name: "Goated" },
    { k: "B", kg: 15, name: "That's pretty good" },
    { k: "C", kg: 10, name: "Meh" },
    { k: "D", kg: 5, name: "Damn ts ass" },
    { k: "F", kg: 2.5, name: "Ts sucks so fucking bad" }
  ];
  var TK = TIERS.map(function (t) { return t.k; });
  var ZONES = TK.concat("R");
  var PLATE_VAR = { S: "--plate-red", A: "--plate-blue", B: "--plate-yellow", C: "--plate-green", D: "--plate-white", F: "--plate-black", R: "--plate-rack" };
  var LOCAL_KEY = "wl-shoe-tiers-local-v3";

  // ---------- state ----------
  var sb = null;                       // Supabase client, or null in preview mode
  var live = false;                    // true when Supabase is configured and reachable
  var session = null, uid = null, isAdmin = false;
  var shoes = {}, shoesLoaded = false;
  var lists = {};                      // user_id -> {name, tiers, code}
  var mine = emptyList();
  var myRowExists = false;
  var view = { mode: "mine", list: null, label: "" };
  var dirty = false, saving = false, saveTimer = null, lastFocusId = null;

  function emptyTiers() { var t = {}; TK.forEach(function (k) { t[k] = []; }); return t; }
  function emptyList() { return { name: "", tiers: emptyTiers(), code: "" }; }
  function cleanTiers(src) {
    var out = emptyTiers(), seen = {};
    if (!src || typeof src !== "object") return out;
    TK.forEach(function (k) {
      var arr = Array.isArray(src[k]) ? src[k] : [];
      out[k] = arr.filter(function (id) { if (typeof id !== "string" || id.length > 60 || seen[id]) return false; seen[id] = true; return true; }).slice(0, 300);
    });
    return out;
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { if (v === null || v === undefined || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function cleanShoe(d) {
    if (!d || typeof d !== "object" || typeof d.id !== "string") return null;
    var model = str(d.model, 60); if (!model) return null;
    var photo = d.photo_url != null ? d.photo_url : d.photo;
    if (typeof photo !== "string" || !(/^images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(photo) || /^https:\/\/[^\s"'<>()]+$/.test(photo))) photo = null;
    var type = d.type === "runner" ? "other" : d.type;
    return {
      id: d.id, brand: str(d.brand, 40), model: model,
      heel: num(d.heel), heelLabel: str(d.heel_label != null ? d.heel_label : d.heelLabel, 20),
      weight: num(d.weight), price: num(d.price), priceLabel: str(d.price_label != null ? d.price_label : d.priceLabel, 20),
      closure: str(d.closure, 40), fit: str(d.fit, 40),
      type: ["lifter", "trainer", "barefoot", "other"].indexOf(type) !== -1 ? type : "lifter",
      notes: str(d.notes, 400), photo: photo, addedBy: typeof d.added_by === "string" ? d.added_by : ""
    };
  }
  function shown() { return view.mode === "shared" && view.list ? view.list : mine; }
  function editable() { return view.mode === "mine"; }
  function tierOf(list, id) { for (var i = 0; i < TK.length; i++) if (list.tiers[TK[i]].indexOf(id) !== -1) return TK[i]; return "R"; }
  function tierInfo(k) { return TIERS[TK.indexOf(k)]; }
  var TYPE_ORDER = { lifter: 0, barefoot: 1, trainer: 2, other: 3 };
  function rackIds(list) {
    var placed = {};
    TK.forEach(function (k) { list.tiers[k].forEach(function (id) { placed[id] = true; }); });
    return Object.keys(shoes).filter(function (id) { return !placed[id]; }).sort(function (a, b) {
      var A = shoes[a], B = shoes[b];
      return (TYPE_ORDER[A.type] - TYPE_ORDER[B.type]) || (A.brand + A.model).localeCompare(B.brand + B.model);
    });
  }
  function ranked(l) { return TK.reduce(function (n, k) { return n + l.tiers[k].filter(function (id) { return shoes[id]; }).length; }, 0); }
  function priceText(s) { return s.priceLabel || (s.price != null ? "$" + s.price : ""); }
  function heelText(s) {
    if (s.heel == null) return s.type === "trainer" ? "Flat trainer" : "Heel not listed";
    return s.heelLabel || (s.heel + " mm");
  }

  // ---------- drawing for shoes without a photo ----------
  function shoeSVG(shoe) {
    var G = 86, f = 6;
    var H = shoe.heel != null ? Math.max(2, Math.min(32, shoe.heel) * 1.2) : 2.5;
    function ys(x) { var t = Math.min(1, Math.max(0, (x - 72) / 50)); return G - f - H * t; }
    function p(x, h) { return x + "," + (ys(x) - h).toFixed(1); }
    var upper = "M" + p(14, 0) + " C" + p(5, 10) + " " + p(14, 21) + " " + p(34, 21) + " L" + p(92, 34) + " L" + p(120, 45) + " L" + p(170, 43) +
      " Q" + p(188, 36) + " " + p(184, 6) + " L" + p(184, 0) + " L" + p(122, 0) + " L" + p(72, 0) + " Z";
    var sole = "M12," + G + " L184," + G + " L184," + ys(184).toFixed(1) + " L122," + ys(122).toFixed(1) + " L72," + ys(72).toFixed(1) + " L14," + ys(14).toFixed(1) + " Q6," + (G - f / 2) + " 12," + G + " Z";
    return '<svg viewBox="0 0 200 92" aria-hidden="true" focusable="false"><line x1="4" x2="196" y1="86.5" y2="86.5" stroke="var(--line)"/>' +
      '<path d="' + upper + '" fill="var(--shoe)" stroke="var(--shoe-line)" stroke-width="1.1" stroke-linejoin="round"/>' +
      '<path d="' + sole + '" fill="var(--sole)" stroke="var(--shoe-line)" stroke-width="1" stroke-linejoin="round"/></svg>';
  }
  function pic(s, big) {
    if (s.photo) return '<img class="photo' + (big ? " big" : "") + '" src="' + esc(s.photo) + '" alt="' + esc(s.brand + " " + s.model) + '" loading="lazy" draggable="false">';
    return shoeSVG(s);
  }

  // ---------- rendering ----------
  var board = document.getElementById("board");
  function cardHTML(s) {
    var tags = '<span class="tag">' + esc(heelText(s)) + "</span>";
    if (priceText(s)) tags += '<span class="tag">' + esc(priceText(s)) + "</span>";
    if (s.addedBy) tags += '<span class="tag new">Added</span>';
    return '<button type="button" class="card" data-id="' + esc(s.id) + '" aria-label="' + esc(s.brand + " " + s.model + ", " + heelText(s)) + '. Open details">' +
      pic(s, false) + '<span class="brand">' + esc(s.brand) + '</span><span class="model">' + esc(s.model) + '</span><span class="meta">' + tags + "</span></button>";
  }
  function render() {
    var list = shown(), html = "";
    if (!shoesLoaded) html = '<p class="empty-note" style="margin:12px">Loading the shoe rack…</p>';
    else if (!Object.keys(shoes).length) html = '<p class="empty-note" style="margin:12px">The shoe database is empty. Add the first shoe with “+ Add a shoe”.</p>';
    else {
      TIERS.forEach(function (t) {
        html += '<div class="tier" data-drop="' + t.k + '"><div class="tier-label"><div class="plate" data-k="' + t.k + '">' + t.k + '</div><div class="tier-kg">' + t.kg + ' kg</div><div class="tier-name">' + esc(t.name) + '</div></div>' +
          '<div class="cards" role="list" aria-label="' + t.k + " tier, " + esc(t.name) + '">' +
          list.tiers[t.k].map(function (id) { return shoes[id] ? cardHTML(shoes[id]) : ""; }).join("") + "</div></div>";
      });
      html += '<div class="tier rack" data-drop="R"><div class="tier-label"><div class="plate" data-k="R">RACK</div><div class="tier-name">Unranked</div></div>' +
        '<div class="cards" role="list" aria-label="Rack, unranked">' + rackIds(list).map(function (id) { return cardHTML(shoes[id]); }).join("") + "</div></div>";
    }
    board.innerHTML = html;
    board.classList.toggle("readonly", !editable());
    renderChart(); renderLists(); renderChrome();
    if (lastFocusId) { var el = board.querySelector('.card[data-id="' + cssEsc(lastFocusId) + '"]'); if (el) el.focus(); lastFocusId = null; }
  }
  function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }

  function renderChrome() {
    document.getElementById("stat-count").textContent = shoesLoaded ? Object.keys(shoes).length + " shoes on the rack" : "Loading shoes";
    var n = Object.keys(lists).filter(function (u) { return ranked(lists[u]) > 0; }).length;
    document.getElementById("stat-lists").textContent = live ? n + (n === 1 ? " saved list" : " saved lists") : "";
    var shared = view.mode === "shared";
    document.getElementById("viewing").classList.toggle("show", shared);
    if (shared) document.getElementById("viewing-text").textContent = "You're looking at " + view.label + ". It's read-only.";
    var ed = editable();
    var addBtn = document.getElementById("btn-add");
    addBtn.disabled = live ? false : true;
    addBtn.title = live ? "" : "Adding shoes needs the shared database, which isn't connected yet";
    document.getElementById("btn-share").disabled = shared;
    document.getElementById("btn-reset").disabled = !ed;
    document.getElementById("hint").style.display = ed ? "" : "none";
  }

  function renderLists() {
    var el = document.getElementById("lists");
    if (!live) { el.innerHTML = '<p class="empty-note">Saved lists show up here once accounts are switched on. Until then, use “Share my list” to send yours as a link.</p>'; return; }
    var ids = Object.keys(lists).filter(function (u) { return ranked(lists[u]) > 0; })
      .sort(function (a, b) { return (a === uid ? -1 : b === uid ? 1 : 0) || ranked(lists[b]) - ranked(lists[a]); });
    if (!ids.length) { el.innerHTML = '<p class="empty-note">No one has saved a list yet. Sign in, rank a few shoes, and yours shows up here.</p>'; return; }
    el.innerHTML = ids.map(function (u) {
      var l = lists[u], tops = [];
      TK.forEach(function (k) { l.tiers[k].forEach(function (id) { if (shoes[id] && tops.length < 3) tops.push([k, id]); }); });
      return '<button type="button" class="list-card" data-uid="' + esc(u) + '"><span class="who">' + esc(u === uid ? "Your list" : (l.name || "A lifter") + "'s list") + "</span>" +
        '<span class="stats">' + ranked(l) + " ranked</span>" +
        '<span class="tops">' + tops.map(function (t) { return '<span class="plate sm" data-k="' + t[0] + '">' + t[0] + "</span>" + esc(shoes[t[1]].model); }).join(" ") + "</span></button>";
    }).join("");
  }

  function renderChart() {
    var list = shown(), MAX = 30;
    var rows = Object.keys(shoes).map(function (id) { return shoes[id]; }).filter(function (s) { return s.heel != null; })
      .sort(function (a, b) { return b.heel - a.heel || a.model.localeCompare(b.model); });
    if (!rows.length) { document.getElementById("chart").innerHTML = '<p class="empty-note">No heel heights yet.</p>'; return; }
    var html = '<div class="c-gridlines">';
    [0, 5, 10, 15, 20, 25, 30].forEach(function (v) { html += '<i style="left:' + (v / MAX * 100) + '%"></i>'; });
    html += '<i class="ref" style="left:' + (19 / MAX * 100) + '%"></i><em style="left:' + (19 / MAX * 100) + '%">¾ in · 19 mm</em></div><div style="height:16px"></div>';
    rows.forEach(function (s) {
      var z = tierOf(list, s.id);
      html += '<div class="c-row"><div class="c-name" title="' + esc(s.brand + " " + s.model) + '">' + esc(s.model) + " <span>" + esc(s.brand) + "</span></div>" +
        '<div class="c-track"><div class="c-bar" style="width:' + Math.min(100, s.heel / MAX * 100) + "%;--p:var(" + PLATE_VAR[z] + ')"></div></div>' +
        '<div class="c-val">' + esc(s.heelLabel ? s.heelLabel.replace(" mm", "") : s.heel) + " mm<br><span>" + (s.heel / 25.4).toFixed(2) + " in</span></div></div>";
    });
    html += '<div class="c-axis"><div></div><div class="c-ticks">';
    [0, 5, 10, 15, 20, 25, 30].forEach(function (v) { html += '<span style="left:' + (v / MAX * 100) + '%">' + v + "</span>"; });
    html += '</div><div class="c-ticks"><span style="right:0;left:auto;transform:none">mm</span></div></div>';
    document.getElementById("chart").innerHTML = html;
  }

  // ---------- account banner ----------
  function renderAccount() {
    var a = document.getElementById("account"), t = document.getElementById("account-text"), act = document.getElementById("acct-actions");
    if (!live) {
      a.className = "account warn";
      t.innerHTML = "<strong>Preview mode.</strong> Your list saves in this browser, and “Share my list” makes a link with your whole list in it. Accounts and adding shoes turn on once the database is connected.";
      act.innerHTML = ""; return;
    }
    if (!uid) {
      a.className = "account";
      t.innerHTML = "<strong>Not signed in.</strong> Rank away; sign in to save your list to an account, share it, and add shoes.";
      act.innerHTML = '<button class="btn primary" type="button" id="btn-signin">Sign in</button>';
      return;
    }
    a.className = "account ok";
    t.innerHTML = "<strong>Signed in" + (mine.name ? " as " + esc(mine.name) : "") + ".</strong> Your list saves as you go.";
    act.innerHTML = '<button class="btn" type="button" id="btn-rename">Change name</button><button class="btn" type="button" id="btn-signout">Sign out</button>';
  }
  function setSave(t) { document.getElementById("save-state").textContent = t; }
  document.getElementById("acct-actions").addEventListener("click", function (e) {
    if (e.target.id === "btn-signin") openSignIn();
    else if (e.target.id === "btn-signout") sb.auth.signOut();
    else if (e.target.id === "btn-rename") openName();
  });

  // ---------- saving ----------
  function changed() {
    if (!live || !uid) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ tiers: mine.tiers })); } catch (e) {} return; }
    dirty = true; setSave("Unsaved");
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
  }
  function flush() {
    if (!dirty || !live || !uid) return;
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); return; }
    saving = true; dirty = false; setSave("Saving…");
    var row = { user_id: uid, display_name: mine.name || "Lifter", tiers: mine.tiers, share_code: mine.code || null, updated_at: new Date().toISOString() };
    sb.from("lists").upsert(row).then(function (res) {
      saving = false;
      if (res.error) { dirty = true; setSave("Not saved"); toast("Couldn't save your list: " + res.error.message); return; }
      myRowExists = true;
      lists[uid] = { name: mine.name, tiers: JSON.parse(JSON.stringify(mine.tiers)), code: mine.code };
      setSave(dirty ? "Unsaved" : "Saved");
      if (dirty) flush(); else renderLists();
    });
  }

  // ---------- moving shoes ----------
  function moveTo(id, zone, index) {
    TK.forEach(function (k) { var i = mine.tiers[k].indexOf(id); if (i !== -1) mine.tiers[k].splice(i, 1); });
    if (zone !== "R") { var arr = mine.tiers[zone]; if (index == null || index > arr.length) arr.push(id); else arr.splice(index, 0, id); }
    changed();
  }
  function shift(id, delta) {
    var z = tierOf(mine, id); if (z === "R") return false;
    var arr = mine.tiers[z], i = arr.indexOf(id), j = i + delta;
    if (j < 0 || j >= arr.length) return false;
    arr.splice(i, 1); arr.splice(j, 0, id); changed(); return true;
  }
  function zoneLabel(k) { return k === "R" ? "the rack" : k + " tier"; }

  // ---------- drag and drop ----------
  var drag = null, suppressClick = false;
  board.addEventListener("pointerdown", function (e) {
    if (!editable()) return;
    var card = e.target.closest(".card");
    if (!card || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag = { id: card.dataset.id, card: card, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false, type: e.pointerType, timer: null };
    if (e.pointerType === "mouse") { e.preventDefault(); try { card.focus({ preventScroll: true }); } catch (er) {} }
    else drag.timer = setTimeout(function () { if (drag && !drag.active) begin(); }, 280);
  });
  window.addEventListener("pointermove", function (e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    var dist = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy);
    if (!drag.active) {
      if (drag.type !== "mouse") { if (dist > 9) { clearTimeout(drag.timer); drag = null; } return; }
      if (dist < 5) return;
      begin();
    }
    follow(); place();
  });
  function end(commit) {
    if (!drag) return;
    clearTimeout(drag.timer);
    if (drag.active) {
      if (drag.ghost) drag.ghost.remove();
      drag.card.classList.remove("placeholder");
      document.body.classList.remove("dragging");
      board.querySelectorAll(".tier.over").forEach(function (t) { t.classList.remove("over"); });
      if (commit) {
        board.querySelectorAll("[data-drop]").forEach(function (zoneEl) {
          var k = zoneEl.dataset.drop; if (k === "R") return;
          mine.tiers[k] = Array.prototype.map.call(zoneEl.querySelectorAll(".card"), function (c) { return c.dataset.id; });
        });
        changed();
      }
      suppressClick = true; setTimeout(function () { suppressClick = false; }, 60);
      render();
    }
    drag = null;
  }
  window.addEventListener("pointerup", function () { end(true); });
  window.addEventListener("pointercancel", function () { end(true); });
  document.addEventListener("touchmove", function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) { if (drag) e.preventDefault(); });
  window.addEventListener("keydown", function (e) { if (e.key === "Escape" && drag && drag.active) end(false); });
  function begin() {
    var card = drag.card, r = card.getBoundingClientRect();
    drag.active = true; drag.ox = drag.sx - r.left; drag.oy = drag.sy - r.top;
    var g = card.cloneNode(true); g.classList.add("ghost"); g.removeAttribute("data-id"); g.setAttribute("aria-hidden", "true"); g.style.width = r.width + "px";
    document.body.appendChild(g); drag.ghost = g;
    card.classList.add("placeholder"); document.body.classList.add("dragging");
    if (navigator.vibrate && drag.type !== "mouse") { try { navigator.vibrate(12); } catch (e) {} }
    follow();
  }
  function follow() {
    if (!drag.ghost) return;
    drag.ghost.style.transform = "translate(" + (drag.x - drag.ox) + "px," + (drag.y - drag.oy) + "px)";
    if (drag.y < 70) window.scrollBy(0, -14); else if (drag.y > window.innerHeight - 70) window.scrollBy(0, 14);
  }
  function place() {
    var el = document.elementFromPoint(drag.x, drag.y);
    var zone = el && el.closest ? el.closest("[data-drop]") : null;
    board.querySelectorAll(".tier.over").forEach(function (t) { if (t !== zone) t.classList.remove("over"); });
    if (!zone) return;
    zone.classList.add("over");
    var list = zone.querySelector(".cards"), cards = list.querySelectorAll(".card:not(.placeholder)"), ref = null;
    for (var i = 0; i < cards.length; i++) {
      var r = cards[i].getBoundingClientRect();
      if (drag.y < r.top) { ref = cards[i]; break; }
      if (drag.y <= r.bottom && drag.x < r.left + r.width / 2) { ref = cards[i]; break; }
    }
    if (ref) { if (ref !== drag.card.nextSibling || drag.card.parentNode !== list) list.insertBefore(drag.card, ref); }
    else if (list.lastElementChild !== drag.card) list.appendChild(drag.card);
  }
  board.addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (!card || suppressClick) return;
    openDetail(card.dataset.id);
  });
  board.addEventListener("keydown", function (e) {
    if (!editable()) return;
    var card = e.target.closest(".card");
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return;
    var id = card.dataset.id, k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (ZONES.indexOf(k) !== -1) { e.preventDefault(); moveTo(id, k); lastFocusId = id; render(); toast(shoes[id].model + " → " + zoneLabel(k)); }
    else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); if (shift(id, k === "ArrowLeft" ? -1 : 1)) { lastFocusId = id; render(); } }
  });

  // ---------- dialogs: shared helpers ----------
  function wireClose(dlg) { dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); }); }
  ["detail", "shoe-dlg", "signin-dlg", "name-dlg", "share-dlg"].forEach(function (id) { wireClose(document.getElementById(id)); });

  // ---------- shoe detail ----------
  var detail = document.getElementById("detail"), detailBody = document.getElementById("detail-body");
  function canEditShoe(s) { return live && uid && (isAdmin || (s.addedBy && s.addedBy === uid)); }
  function openDetail(id) {
    var s = shoes[id]; if (!s) return;
    var list = shown(), z = tierOf(list, id), ed = editable();
    function spec(label, val) { return "<div><dt>" + label + "</dt><dd>" + esc(val) + "</dd></div>"; }
    var chips = ZONES.map(function (k) {
      var label = k === "R" ? "Rack" : k + " · " + tierInfo(k).name;
      return '<button type="button" class="chip" data-move="' + k + '" aria-pressed="' + (k === z) + '"><span class="plate sm" data-k="' + k + '">' + (k === "R" ? "–" : k) + "</span>" + esc(label) + "</button>";
    }).join("");
    detailBody.innerHTML =
      '<div class="dlg-head"><div class="plate" data-k="' + z + '"' + (z === "R" ? ' style="font-size:15px"' : "") + ">" + (z === "R" ? "RACK" : z) + "</div>" +
      '<div class="titles"><span class="kicker">' + esc(s.brand) + '</span><h3 id="d-title">' + esc(s.model) + '</h3></div><button class="x" type="button" data-close aria-label="Close">×</button></div>' +
      pic(s, true) +
      '<dl class="specs">' +
      spec("Effective heel", s.heel != null ? heelText(s) + " (" + (s.heel / 25.4).toFixed(2) + " in)" : heelText(s)) +
      spec("Weight per shoe", s.weight != null ? (s.weight ? s.weight + " g (" + (s.weight / 28.35).toFixed(1) + " oz)" : "Weightless") : "Not listed") +
      spec("List price", priceText(s) || "Not listed") +
      spec("Closure", s.closure || "—") + spec("Fit", s.fit || "—") +
      spec(view.mode === "shared" ? "Their tier" : "Your tier", z === "R" ? "Unranked" : z + " · " + tierInfo(z).name) +
      "</dl>" + (s.notes ? '<p class="notes">' + esc(s.notes) + "</p>" : "") +
      (ed ? '<span class="move-label">Move to</span><div class="chips">' + chips + "</div>" : "") +
      '<div class="row"><span style="flex:1"></span>' +
      (canEditShoe(s) ? '<button type="button" class="btn" data-edit="' + esc(id) + '">Edit details</button>' : "") +
      (live && isAdmin ? '<button type="button" class="danger" data-remove="' + esc(id) + '">Remove from database</button>' : "") +
      "</div>";
    detailBody.dataset.id = id;
    if (!detail.open) detail.showModal();
  }
  detail.addEventListener("click", function (e) {
    var id = detailBody.dataset.id;
    var mv = e.target.closest("[data-move]");
    if (mv) { moveTo(id, mv.dataset.move); render(); openDetail(id); toast(shoes[id].model + " → " + zoneLabel(mv.dataset.move)); return; }
    var edb = e.target.closest("[data-edit]");
    if (edb) { detail.close(); openShoeForm(id); return; }
    var rm = e.target.closest("[data-remove]");
    if (rm) {
      if (rm.dataset.armed !== "1") { rm.dataset.armed = "1"; rm.textContent = "Click again to remove it for everyone"; return; }
      var name = shoes[id].model;
      sb.from("shoes").delete().eq("id", id).then(function (res) {
        if (res.error) { toast("Couldn't remove it: " + res.error.message); return; }
        delete shoes[id]; detail.close(); render(); toast("Removed " + name);
      });
    }
  });

  // ---------- add / edit a shoe ----------
  var shoeDlg = document.getElementById("shoe-dlg"), form = document.getElementById("shoe-form");
  var editingId = null, photoBlob = null;
  function openShoeForm(id) {
    if (!live) return;
    if (!uid) { openSignIn("Sign in to add a shoe."); return; }
    form.reset(); photoBlob = null; editingId = id || null;
    var pv = document.getElementById("f-preview"); pv.classList.remove("show"); pv.removeAttribute("src");
    document.getElementById("f-err").textContent = "";
    document.getElementById("f-title").textContent = id ? "Edit shoe" : "Add a shoe";
    document.getElementById("f-submit").textContent = id ? "Save changes" : "Add to the rack";
    document.getElementById("f-note").textContent = id ? "Changes show up for everyone." : "New shoes go into the shared database and land on everyone's rack.";
    if (id && shoes[id]) {
      var s = shoes[id];
      form.brand.value = s.brand; form.model.value = s.model;
      form.heel.value = s.heel != null ? s.heel : ""; form.price.value = s.price != null ? s.price : "";
      form.type.value = s.type; form.fit.value = s.fit; form.notes.value = s.notes;
      if (s.photo) { pv.src = s.photo; pv.classList.add("show"); }
    }
    shoeDlg.showModal();
  }
  document.getElementById("f-photo").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    if (!/^image\//.test(file.type)) { document.getElementById("f-err").textContent = "That file isn't an image."; return; }
    shrink(file, function (blob, url) { photoBlob = blob; var pv = document.getElementById("f-preview"); pv.src = url; pv.classList.add("show"); },
      function () { document.getElementById("f-err").textContent = "Couldn't read that image. Try a JPEG or PNG."; });
  });
  function shrink(file, ok, fail) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var sc = Math.min(1, 900 / img.naturalWidth), w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (!b) return fail(); ok(b, c.toDataURL("image/jpeg", 0.7)); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail(); };
    img.src = url;
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = document.getElementById("f-err"); err.textContent = "";
    var brand = form.brand.value.trim(), model = form.model.value.trim();
    if (!brand || !model) { err.textContent = "Brand and model are both needed."; return; }
    var heel = parseFloat(form.heel.value), price = parseFloat(form.price.value);
    var row = {
      brand: brand.slice(0, 40), model: model.slice(0, 60), heel: isFinite(heel) ? heel : null, price: isFinite(price) ? Math.round(price) : null,
      type: form.type.value, fit: form.fit.value.trim().slice(0, 40) || null, notes: form.notes.value.trim().slice(0, 400) || null
    };
    var id = editingId || ((brand + "-" + model).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) + "-" + Math.random().toString(36).slice(2, 6));
    var btn = document.getElementById("f-submit"); btn.disabled = true; btn.textContent = "Saving…";
    var upload = Promise.resolve(null);
    if (photoBlob) {
      var path = uid + "/" + id + "-" + Date.now() + ".jpg";
      upload = sb.storage.from("shoe-photos").upload(path, photoBlob, { contentType: "image/jpeg", upsert: true }).then(function (res) {
        if (res.error) { err.textContent = "The photo didn't upload (" + res.error.message + "), so the shoe was saved without it."; return null; }
        return sb.storage.from("shoe-photos").getPublicUrl(path).data.publicUrl;
      });
    }
    upload.then(function (url) {
      if (url) row.photo_url = url;
      if (editingId) {
        if (shoes[editingId] && row.heel !== shoes[editingId].heel) row.heel_label = null;
        return sb.from("shoes").update(row).eq("id", editingId).select().single();
      }
      row.id = id; row.added_by = uid;
      return sb.from("shoes").insert(row).select().single();
    }).then(function (res) {
      if (res.error) { err.textContent = "Couldn't save: " + res.error.message; return; }
      var s = cleanShoe(res.data); if (s) shoes[s.id] = s;
      shoeDlg.close(); render(); toast(editingId ? "Saved " + model : model + " is on the rack");
    }).catch(function () { err.textContent = "Couldn't save. Check your connection and try again."; })
      .then(function () { btn.disabled = false; btn.textContent = editingId ? "Save changes" : "Add to the rack"; });
  });
  document.getElementById("btn-add").addEventListener("click", function () { openShoeForm(null); });

  // ---------- sign in / name ----------
  var siDlg = document.getElementById("signin-dlg"), siForm = document.getElementById("signin-form");
  function openSignIn(msg) {
    document.getElementById("si-err").textContent = msg || "";
    var g = !!CFG.googleSignIn;
    document.getElementById("btn-google").hidden = !g; document.getElementById("or-line").hidden = !g;
    siDlg.showModal();
  }
  function redirectUrl() { return location.origin + location.pathname; }
  document.getElementById("btn-google").addEventListener("click", function () {
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectUrl() } }).then(function (res) {
      if (res.error) document.getElementById("si-err").textContent = res.error.message;
    });
  });
  siForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = siForm.email.value.trim(), err = document.getElementById("si-err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "That email doesn't look right."; return; }
    var btn = document.getElementById("si-submit"); btn.disabled = true; btn.textContent = "Sending…";
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl() } }).then(function (res) {
      btn.disabled = false; btn.textContent = "Email me a sign-in link";
      if (res.error) { err.textContent = res.error.message; return; }
      siDlg.close(); toast("Check your email for the sign-in link");
    });
  });
  var nameDlg = document.getElementById("name-dlg"), nameForm = document.getElementById("name-form");
  function openName() { nameForm.name.value = mine.name || ""; document.getElementById("n-err").textContent = ""; nameDlg.showModal(); }
  nameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var n = nameForm.name.value.trim().slice(0, 30);
    if (!n) { document.getElementById("n-err").textContent = "Pick a name to show on your list."; return; }
    mine.name = n; nameDlg.close(); dirty = true; flush(); renderAccount();
  });

  // ---------- share ----------
  var shareDlg = document.getElementById("share-dlg");
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
  function shareLink() {
    var base = location.origin + location.pathname;
    if (live && uid) {
      if (!mine.code) { mine.code = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6); dirty = true; flush(); }
      return base + "#list-" + mine.code;
    }
    var compact = {}; TK.forEach(function (k) { if (mine.tiers[k].length) compact[k] = mine.tiers[k]; });
    return base + "#s=" + b64url(JSON.stringify(compact));
  }
  document.getElementById("btn-share").addEventListener("click", function () {
    if (live && !uid) { openSignIn("Sign in to get a share link for your list."); return; }
    document.getElementById("share-link").value = shareLink();
    document.getElementById("share-note").textContent = live ? "Anyone with this link sees your list read-only, and can start their own. It stays up to date as you change it." :
      "This link holds your whole list as it is right now. If you change your list, share a new link.";
    shareDlg.showModal(); document.getElementById("share-link").select();
  });
  function copy(text, ok) {
    try { navigator.clipboard.writeText(text).then(function () { toast(ok); }, function () { toast("Select the text and copy it yourself."); }); }
    catch (e) { toast("Select the text and copy it yourself."); }
  }
  document.getElementById("btn-copy-link").addEventListener("click", function () { copy(document.getElementById("share-link").value, "Link copied"); });
  document.getElementById("btn-copy-text").addEventListener("click", function () {
    var lines = TIERS.map(function (t) { return t.k + " (" + t.name + "): " + (mine.tiers[t.k].filter(function (id) { return shoes[id]; }).map(function (id) { return shoes[id].brand + " " + shoes[id].model; }).join(", ") || "—"); });
    copy("My weightlifting shoe tier list\n" + lines.join("\n") + "\n" + document.getElementById("share-link").value, "List copied");
  });

  // ---------- other controls ----------
  var resetArmed = false, resetBtn = document.getElementById("btn-reset");
  resetBtn.addEventListener("click", function () {
    if (!resetArmed) { resetArmed = true; resetBtn.textContent = "Click again to clear your ranking"; setTimeout(function () { resetArmed = false; resetBtn.textContent = "Put everything back on the rack"; }, 3000); return; }
    resetArmed = false; resetBtn.textContent = "Put everything back on the rack";
    mine.tiers = emptyTiers(); changed(); render(); toast("Everything is back on the rack");
  });
  document.getElementById("lists").addEventListener("click", function (e) {
    var c = e.target.closest(".list-card"); if (!c) return;
    var u = c.dataset.uid;
    if (u === uid) { goMine(); return; }
    var l = lists[u]; if (!l) return;
    if (l.code) location.hash = "list-" + l.code;
    else { view = { mode: "shared", list: l, label: (l.name || "A lifter") + "'s list" }; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  });
  document.getElementById("btn-back").addEventListener("click", goMine);
  function goMine() {
    view = { mode: "mine", list: null, label: "" };
    if (location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; } }
    render();
  }

  // ---------- routing ----------
  function applyHash() {
    var h = location.hash || "";
    var m = /^#list-([a-z0-9]{6,16})$/.exec(h);
    if (m) {
      if (!live) { toast("Saved lists need the shared database, which isn't connected here."); return; }
      if (mine.code && m[1] === mine.code && uid) { view = { mode: "mine", list: null, label: "" }; render(); return; }
      sb.from("lists").select("user_id,display_name,tiers,share_code").eq("share_code", m[1]).maybeSingle().then(function (res) {
        if (res.error || !res.data) { toast("That shared list wasn't found."); return; }
        var l = { name: str(res.data.display_name, 30), tiers: cleanTiers(res.data.tiers), code: res.data.share_code };
        if (res.data.user_id === uid) { view = { mode: "mine", list: null, label: "" }; }
        else view = { mode: "shared", list: l, label: (l.name || "A lifter") + "'s list" };
        render(); window.scrollTo({ top: 0 });
      });
      return;
    }
    var s = /^#s=([A-Za-z0-9_-]{1,6000})$/.exec(h);
    if (s) {
      try {
        var tiers = cleanTiers(JSON.parse(unb64url(s[1])));
        view = { mode: "shared", list: { name: "", tiers: tiers, code: "" }, label: "a shared list" };
        render(); window.scrollTo({ top: 0 });
      } catch (e) { toast("That share link is broken."); }
      return;
    }
    if (view.mode === "shared") { view = { mode: "mine", list: null, label: "" }; render(); }
  }
  window.addEventListener("hashchange", applyHash);

  var toastEl = document.getElementById("toast"), toastTimer = null;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600); }

  // ---------- data loading ----------
  function loadLocalList() {
    try { var raw = localStorage.getItem(LOCAL_KEY); if (raw) { var d = JSON.parse(raw); mine.tiers = cleanTiers(d.tiers); } } catch (e) {}
  }
  function loadShoesFromFile() {
    return fetch("data/shoes.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (arr) {
      shoes = {}; (arr || []).forEach(function (d) { var s = cleanShoe(d); if (s) shoes[s.id] = s; });
    });
  }
  function loadShoesFromDb() {
    return sb.from("shoes").select("*").limit(1000).then(function (res) {
      if (res.error) throw res.error;
      var next = {}; res.data.forEach(function (d) { var s = cleanShoe(d); if (s) next[s.id] = s; }); shoes = next;
    });
  }
  function loadLists() {
    return sb.from("lists").select("user_id,display_name,tiers,share_code,updated_at").order("updated_at", { ascending: false }).limit(100).then(function (res) {
      if (res.error) return;
      var next = {};
      res.data.forEach(function (d) { next[d.user_id] = { name: str(d.display_name, 30), tiers: cleanTiers(d.tiers), code: d.share_code || "" }; });
      lists = next;
    });
  }
  function onSignedIn(newUid) {
    if (uid === newUid) return;
    uid = newUid;
    var localTiers = mine.tiers;
    sb.rpc("is_admin").then(function (r) { isAdmin = !r.error && r.data === true; render(); });
    sb.from("lists").select("display_name,tiers,share_code").eq("user_id", uid).maybeSingle().then(function (res) {
      if (res.data) {
        myRowExists = true;
        mine = { name: str(res.data.display_name, 30), tiers: cleanTiers(res.data.tiers), code: res.data.share_code || "" };
        if (!ranked(mine) && ranked({ tiers: localTiers })) { mine.tiers = localTiers; dirty = true; flush(); }
      } else {
        myRowExists = false;
        mine = { name: "", tiers: localTiers, code: "" };
        openName();
      }
      renderAccount(); render(); applyHash();
    });
  }
  function onSignedOut() {
    uid = null; isAdmin = false; mine = emptyList(); loadLocalList(); setSave(""); renderAccount(); render();
  }

  function startPreview() {
    live = false; loadLocalList(); renderAccount();
    loadShoesFromFile().catch(function () { shoes = {}; }).then(function () { shoesLoaded = true; render(); applyHash(); });
  }
  function startLive() {
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
    } catch (e) { startPreview(); return; }
    live = true; loadLocalList(); renderAccount(); render();
    Promise.all([loadShoesFromDb(), loadLists()]).then(function () {
      shoesLoaded = true; render(); applyHash();
    }, function (err) {
      live = false; sb = null;
      toast("The database didn't answer, so this is running in preview mode.");
      startPreview();
    });
    sb.auth.onAuthStateChange(function (event, sess) {
      session = sess;
      if (sess && sess.user) onSignedIn(sess.user.id);
      else if (event === "SIGNED_OUT") onSignedOut();
      if (/[?&]code=/.test(location.search)) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }
      renderAccount();
    });
    var lastRefresh = Date.now();
    window.addEventListener("focus", function () {
      if (!live || Date.now() - lastRefresh < 20000 || drag) return;
      lastRefresh = Date.now();
      Promise.all([loadShoesFromDb(), loadLists()]).then(function () { render(); }, function () {});
    });
  }

  render();
  if (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient) startLive();
  else startPreview();
})();
