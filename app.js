(function () {
  "use strict";

  // ---------- constants ----------
  var CFG = window.TIER_CONFIG || {};
  var TIERS = [
    { k: "S", kg: 25, name: "Light weight, baby!" },
    { k: "A", kg: 20, name: "Goated, no cap" },
    { k: "B", kg: 15, name: "Yeah buddy" },
    { k: "C", kg: 10, name: "Mid, ngl" },
    { k: "D", kg: 5, name: "Skill issue" },
    { k: "F", kg: 2.5, name: "Do you even lift, bro?" }
  ];
  var TK = TIERS.map(function (t) { return t.k; });
  var ZONES = TK.concat("R");
  var PLATE_VAR = { S: "--plate-red", A: "--plate-blue", B: "--plate-yellow", C: "--plate-green", D: "--plate-white", F: "--plate-black", R: "--plate-rack" };
  var LOCAL_KEY = "wl-shoe-tiers-local-v3";
  var OLD_LOCAL_KEYS = ["wl-shoe-tiers-local-v2"];
  var MAX_CUSTOM = 40;
  var APPLE_DEVICE = /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent);
  var USER_RE = /^[a-z0-9_]{3,20}$/;

  // ---------- state ----------
  var sb = null, live = false, uid = null, isAdmin = false;
  var shoes = {}, shoesLoaded = false;      // the shared catalog everyone sees
  var mine = emptyList();                   // my list: tiers plus my private shoes
  var view = { mode: "mine", list: null };  // or { mode: "shared", list }
  var feed = [], feedSort = "top", feedLoaded = false;
  var social = { listId: null, votes: [], comments: [], loading: false };
  var dirty = false, saving = false, saveTimer = null, lastFocusId = null, needName = false;

  function emptyTiers() { var t = {}; TK.forEach(function (k) { t[k] = []; }); return t; }
  function emptyList() { return { userId: null, username: "", name: "", tiers: emptyTiers(), custom: [], published: false, caption: "" }; }
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
  function storagePrefix() { return (CFG.supabaseUrl || "").replace(/\/+$/, "") + "/storage/v1/object/public/shoe-photos/"; }
  // custom = a shoe someone added to their own list only. Its photo must be their upload (live) or a data URL (this browser).
  function cleanShoe(d, custom) {
    if (!d || typeof d !== "object" || typeof d.id !== "string" || d.id.length > 60) return null;
    var model = str(d.model, 60); if (!model) return null;
    var photo = d.photo_url != null ? d.photo_url : d.photo;
    var okPhoto = false;
    if (typeof photo === "string") {
      if (custom) okPhoto = (live && photo.indexOf(storagePrefix()) === 0 && /^[^\s"'<>()]+$/.test(photo)) || (!live && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length < 400000);
      else okPhoto = /^images\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(photo) || /^https:\/\/[^\s"'<>()]+$/.test(photo);
    }
    var type = d.type === "runner" ? "other" : d.type;
    return {
      id: custom ? (d.id.indexOf("c-") === 0 ? d.id : "c-" + d.id).slice(0, 60) : d.id,
      brand: str(d.brand, 40), model: model,
      heel: num(d.heel), heelLabel: str(d.heel_label != null ? d.heel_label : d.heelLabel, 20),
      weight: num(d.weight), price: num(d.price), priceLabel: str(d.price_label != null ? d.price_label : d.priceLabel, 20),
      closure: str(d.closure, 40), fit: str(d.fit, 40),
      type: ["lifter", "trainer", "barefoot", "other"].indexOf(type) !== -1 ? type : "lifter",
      notes: str(d.notes, 400), photo: okPhoto ? photo : null, custom: !!custom
    };
  }
  function cleanCustom(arr) {
    var out = [], seen = {};
    (Array.isArray(arr) ? arr : []).forEach(function (d) { var s = cleanShoe(d, true); if (s && !seen[s.id] && out.length < MAX_CUSTOM) { seen[s.id] = true; out.push(s); } });
    return out;
  }
  function customForSave(arr) {
    return arr.map(function (s) { return { id: s.id, brand: s.brand, model: s.model, heel: s.heel, price: s.price, type: s.type, fit: s.fit, notes: s.notes, photo: s.photo }; });
  }
  function rowToList(d) {
    return {
      userId: d.user_id || null, username: str(d.username, 20), name: str(d.display_name, 30), tiers: cleanTiers(d.tiers),
      custom: cleanCustom(d.custom_shoes), published: !!d.published, caption: str(d.caption, 140), updatedAt: d.updated_at || ""
    };
  }
  function shown() { return view.mode === "shared" && view.list ? view.list : mine; }
  function editable() { return view.mode === "mine"; }
  function pool(list) {
    var p = {};
    Object.keys(shoes).forEach(function (id) { p[id] = shoes[id]; });
    (list.custom || []).forEach(function (s) { p[s.id] = s; });
    return p;
  }
  function tierOf(list, id) { for (var i = 0; i < TK.length; i++) if (list.tiers[TK[i]].indexOf(id) !== -1) return TK[i]; return "R"; }
  function tierInfo(k) { return TIERS[TK.indexOf(k)]; }
  var TYPE_ORDER = { lifter: 0, barefoot: 1, trainer: 2, other: 3 };
  function rackIds(list, P) {
    var placed = {};
    TK.forEach(function (k) { list.tiers[k].forEach(function (id) { placed[id] = true; }); });
    return Object.keys(P).filter(function (id) { return !placed[id]; }).sort(function (a, b) {
      var A = P[a], B = P[b];
      return (B.custom - A.custom) || (TYPE_ORDER[A.type] - TYPE_ORDER[B.type]) || (A.brand + A.model).localeCompare(B.brand + B.model);
    });
  }
  function ranked(l) { var P = pool(l); return TK.reduce(function (n, k) { return n + l.tiers[k].filter(function (id) { return P[id]; }).length; }, 0); }
  function priceText(s) { return s.priceLabel || (s.price != null ? "$" + s.price : ""); }
  function heelText(s) {
    if (s.heel == null) return s.type === "trainer" ? "Flat trainer" : "Heel not listed";
    return s.heelLabel || (s.heel + " mm");
  }
  function who(l) { return l.username ? "@" + l.username : (l.name || "a lifter"); }
  function ago(iso) {
    var t = Date.parse(iso); if (!isFinite(t)) return "";
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + "d ago";
    return new Date(t).toLocaleDateString();
  }
  function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return decodeURIComponent(escape(atob(s))); }
  function cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }
  var $ = function (id) { return document.getElementById(id); };

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
  function pic(s) {
    if (s.photo) return '<img class="photo" src="' + esc(s.photo) + '" alt="' + esc(s.brand + " " + s.model) + '" loading="lazy" draggable="false">';
    return shoeSVG(s);
  }

  // ---------- board ----------
  var board = $("board");
  function cardHTML(s) {
    var tags = '<span class="tag">' + esc(heelText(s)) + "</span>";
    if (priceText(s)) tags += '<span class="tag">' + esc(priceText(s)) + "</span>";
    if (s.custom) tags += '<span class="tag mine">' + (editable() ? "Mine" : "Their add") + "</span>";
    return '<button type="button" class="card" data-id="' + esc(s.id) + '" aria-label="' + esc(s.brand + " " + s.model + ", " + heelText(s)) + '. Open details">' +
      pic(s) + '<span class="brand-s">' + esc(s.brand) + '</span><span class="model">' + esc(s.model) + '</span><span class="meta">' + tags + "</span></button>";
  }
  function render() {
    var list = shown(), P = pool(list), html = "";
    if (!shoesLoaded) html = '<p class="empty-note" style="margin:12px">Loading the shoe rack…</p>';
    else {
      TIERS.forEach(function (t) {
        html += '<div class="tier" data-drop="' + t.k + '"><div class="tier-label"><div class="plate" data-k="' + t.k + '">' + t.k + '</div><div class="tier-kg">' + t.kg + ' kg</div><div class="tier-name">' + esc(t.name) + '</div></div>' +
          '<div class="cards" role="list" aria-label="' + t.k + " tier, " + esc(t.name) + '">' +
          list.tiers[t.k].map(function (id) { return P[id] ? cardHTML(P[id]) : ""; }).join("") + "</div></div>";
      });
      html += '<div class="tier rack" data-drop="R"><div class="tier-label"><div class="plate" data-k="R">RACK</div><div class="tier-name">Still on the rack</div></div>' +
        '<div class="cards" role="list" aria-label="Rack, unranked">' + rackIds(list, P).map(function (id) { return cardHTML(P[id]); }).join("") + "</div></div>";
    }
    board.innerHTML = html;
    board.classList.toggle("readonly", !editable());
    renderChart(); renderChrome(); renderSocial();
    if (lastFocusId) { var el = board.querySelector('.card[data-id="' + cssEsc(lastFocusId) + '"]'); if (el) el.focus(); lastFocusId = null; }
  }

  function renderChrome() {
    var n = Object.keys(shoes).length;
    var posted = feed.length;
    $("stat-count").textContent = shoesLoaded ? n + " shoes on the rack" + (live && feedLoaded ? " · " + posted + (posted === 1 ? " list posted" : " lists posted") : "") : "Loading the rack";
    var shared = view.mode === "shared";
    $("viewing").classList.toggle("show", shared);
    if (shared) $("viewing-text").textContent = "You're looking at " + who(view.list) + "'s list. It's read-only.";
    $("board-h").textContent = shared ? who(view.list) + "'s bar." : "Load the bar.";
    document.querySelector("#board-sec .kicker").textContent = shared ? "Their board" : "Your board";
    $("toolbar").style.display = shared ? "none" : "";
    $("hint").style.display = shared ? "none" : "";
  }

  function renderChart() {
    var list = shown(), P = pool(list), MAX = 30;
    var rows = Object.keys(P).map(function (id) { return P[id]; }).filter(function (s) { return s.heel != null && s.heel > 0; })
      .sort(function (a, b) { return b.heel - a.heel || a.model.localeCompare(b.model); });
    if (!rows.length) { $("chart").innerHTML = '<p class="empty-note">No heel heights yet.</p>'; return; }
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
    $("chart").innerHTML = html;
  }

  // ---------- account ----------
  function renderAccount() {
    var line = $("account"), t = $("account-text"), top = $("acct");
    if (!live) {
      line.className = "account-line warn";
      t.innerHTML = "<strong>Preview mode.</strong> Your list and your own shoes save in this browser, and Share makes a link with your whole list in it. Accounts, posting and comments turn on once the database is connected.";
      top.innerHTML = ""; return;
    }
    if (!uid) {
      line.className = "account-line";
      t.innerHTML = "<strong>Not signed in.</strong> Rank away. Sign in with Apple, Google or email to save your list, post it, and vote and comment on other people's.";
      top.innerHTML = '<button class="btn red sm" type="button" data-act="signin">Sign in</button>';
      return;
    }
    line.className = "account-line ok";
    t.innerHTML = mine.username
      ? "<strong>Signed in as @" + esc(mine.username) + ".</strong> Your list saves as you go." + (mine.published ? " It's posted to the community." : " It's private until you post it.")
      : "<strong>Signed in.</strong> Pick a username so you can post and comment.";
    var initial = (mine.name || mine.username || "?").charAt(0);
    top.innerHTML = '<button class="avatar" type="button" data-act="profile" aria-label="Edit your profile" title="' + esc(mine.username ? "@" + mine.username : "Pick a username") + '">' + esc(initial) + "</button>" +
      '<button class="btn sm" type="button" data-act="signout">Sign out</button>';
  }
  function setSave(t) { $("save-state").textContent = t; }
  $("acct").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "signin") openSignIn();
    else if (b.dataset.act === "signout") sb.auth.signOut();
    else if (b.dataset.act === "profile") openName();
  });

  // ---------- saving ----------
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ tiers: mine.tiers, custom: customForSave(mine.custom) })); }
    catch (e) { toast("This browser is out of room. Try a smaller photo."); }
  }
  function changed() {
    if (!live || !uid) { saveLocal(); return; }
    dirty = true; setSave("Unsaved");
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700);
  }
  function myRow() {
    return {
      user_id: uid, username: mine.username || null, display_name: mine.name || null, tiers: mine.tiers,
      custom_shoes: customForSave(mine.custom), published: !!mine.published, caption: mine.caption || null, updated_at: new Date().toISOString()
    };
  }
  function flush() {
    if (!dirty || !live || !uid) return Promise.resolve();
    if (saving) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 400); return Promise.resolve(); }
    saving = true; dirty = false; setSave("Saving…");
    return sb.from("lists").upsert(myRow()).then(function (res) {
      saving = false;
      if (res.error) { dirty = true; setSave("Not saved"); toast("Couldn't save your list: " + res.error.message); return; }
      setSave(dirty ? "Unsaved" : "Saved");
      if (dirty) flush();
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

  // ---------- drag and drop (mouse drag, or long-press on touch) ----------
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
    var g = card.cloneNode(true); g.classList.add("drag-ghost"); g.removeAttribute("data-id"); g.setAttribute("aria-hidden", "true"); g.style.width = r.width + "px";
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
    var id = card.dataset.id, k = e.key.length === 1 ? e.key.toUpperCase() : e.key, P = pool(mine);
    if (ZONES.indexOf(k) !== -1) { e.preventDefault(); moveTo(id, k); lastFocusId = id; render(); toast(P[id].model + " → " + zoneLabel(k)); }
    else if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); if (shift(id, k === "ArrowLeft" ? -1 : 1)) { lastFocusId = id; render(); } }
  });

  // ---------- dialogs ----------
  function wireClose(dlg) { dlg.addEventListener("click", function (e) { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); }); }
  ["detail", "shoe-dlg", "signin-dlg", "name-dlg", "share-dlg"].forEach(function (id) { wireClose($(id)); });

  // ---------- shoe detail ----------
  var detail = $("detail"), detailBody = $("detail-body");
  function openDetail(id) {
    var list = shown(), P = pool(list), s = P[id]; if (!s) return;
    var z = tierOf(list, id), ed = editable();
    function spec(label, val) { return "<div><dt>" + label + "</dt><dd>" + esc(val) + "</dd></div>"; }
    var chips = ZONES.map(function (k) {
      var label = k === "R" ? "Back on the rack" : tierInfo(k).name;
      return '<button type="button" class="chip" data-move="' + k + '" aria-pressed="' + (k === z) + '"><span class="plate sm" data-k="' + k + '">' + (k === "R" ? "–" : k) + "</span>" + esc(label) + "</button>";
    }).join("");
    var actions = "";
    if (ed && s.custom) actions = '<button type="button" class="btn" data-edit="' + esc(id) + '">Edit</button><button type="button" class="danger" data-delete="' + esc(id) + '">Delete from my rack</button>';
    else if (ed && live && isAdmin && !s.custom) actions = '<button type="button" class="btn" data-edit="' + esc(id) + '">Edit for everyone</button><button type="button" class="danger" data-remove="' + esc(id) + '">Remove for everyone</button>';
    detailBody.innerHTML =
      '<div class="dlg-head"><div class="plate" data-k="' + z + '">' + (z === "R" ? "RACK" : z) + "</div>" +
      '<div class="titles"><span class="kicker">' + esc(s.brand) + (s.custom ? (ed ? " · on your rack only" : " · added by " + esc(who(list))) : "") + '</span><h3 id="d-title">' + esc(s.model) + '</h3></div><button class="x" type="button" data-close aria-label="Close">×</button></div>' +
      pic(s) +
      '<dl class="specs">' +
      spec("Effective heel", s.heel != null && s.heel > 0 ? heelText(s) + " (" + (s.heel / 25.4).toFixed(2) + " in)" : heelText(s)) +
      spec("Weight per shoe", s.weight != null ? (s.weight ? s.weight + " g (" + (s.weight / 28.35).toFixed(1) + " oz)" : "Weightless") : "Not listed") +
      spec("List price", priceText(s) || "Not listed") +
      spec("Closure", s.closure || "—") + spec("Fit", s.fit || "—") +
      spec(ed ? "Your tier" : "Their tier", z === "R" ? "Still on the rack" : z + " · " + tierInfo(z).name) +
      "</dl>" + (s.notes ? '<p class="notes">' + esc(s.notes) + "</p>" : "") +
      (ed ? '<span class="move-label">Move to</span><div class="chips">' + chips + "</div>" : "") +
      (actions ? '<div class="row"><span style="flex:1"></span>' + actions + "</div>" : "");
    detailBody.dataset.id = id;
    if (!detail.open) detail.showModal();
  }
  detail.addEventListener("click", function (e) {
    var id = detailBody.dataset.id, P = pool(mine);
    var mv = e.target.closest("[data-move]");
    if (mv) { moveTo(id, mv.dataset.move); render(); detail.close(); toast(P[id].model + " → " + zoneLabel(mv.dataset.move)); return; }
    var edb = e.target.closest("[data-edit]");
    if (edb) { detail.close(); openShoeForm(id); return; }
    var del = e.target.closest("[data-delete]");
    if (del) {
      if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again to delete it"; return; }
      var name = P[id].model;
      mine.custom = mine.custom.filter(function (s) { return s.id !== id; });
      moveTo(id, "R"); detail.close(); render(); toast("Deleted " + name);
      return;
    }
    var rm = e.target.closest("[data-remove]");
    if (rm) {
      if (rm.dataset.armed !== "1") { rm.dataset.armed = "1"; rm.textContent = "Tap again to remove it for everyone"; return; }
      var nm = shoes[id].model;
      sb.from("shoes").delete().eq("id", id).then(function (res) {
        if (res.error) { toast("Couldn't remove it: " + res.error.message); return; }
        delete shoes[id]; detail.close(); render(); toast("Removed " + nm + " for everyone");
      });
    }
  });

  // ---------- add or edit a shoe ----------
  var shoeDlg = $("shoe-dlg"), form = $("shoe-form");
  var editingId = null, photoBlob = null, photoData = null;
  function openShoeForm(id) {
    if (live && !uid) { openSignIn("Sign in to add your own shoes."); return; }
    form.reset(); photoBlob = null; photoData = null; editingId = id || null;
    var pv = $("f-preview"); pv.classList.remove("show"); pv.removeAttribute("src");
    $("f-err").textContent = "";
    var editingCatalog = !!(id && shoes[id]);
    $("f-title").textContent = id ? (editingCatalog ? "Edit for everyone" : "Edit your shoe") : "Add your own shoe";
    $("f-submit").textContent = id ? "Save changes" : "Add to my rack";
    $("f-everyone-row").hidden = !(live && isAdmin && !id);
    $("f-everyone").checked = false;
    $("f-note").textContent = editingCatalog ? "Changes show up on everyone's rack." :
      "Shoes you add only show on your list and when someone opens your list. Nobody else's rack changes.";
    var s = id ? pool(mine)[id] : null;
    if (s) {
      form.brand.value = s.brand; form.model.value = s.model;
      form.heel.value = s.heel != null ? s.heel : ""; form.price.value = s.price != null ? s.price : "";
      form.type.value = s.type; form.fit.value = s.fit; form.notes.value = s.notes;
      if (s.photo) { pv.src = s.photo; pv.classList.add("show"); }
    }
    shoeDlg.showModal();
  }
  $("f-everyone").addEventListener("change", function (e) {
    $("f-submit").textContent = e.target.checked ? "Add to everyone's rack" : "Add to my rack";
    $("f-note").textContent = e.target.checked ? "This goes into the shared database and lands on every lifter's rack." :
      "Shoes you add only show on your list and when someone opens your list. Nobody else's rack changes.";
  });
  $("f-photo").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    if (file.type && !/^image\//.test(file.type)) { $("f-err").textContent = "That file isn't an image."; return; }
    shrink(file, function (blob, url) { photoBlob = blob; photoData = url; var pv = $("f-preview"); pv.src = url; pv.classList.add("show"); $("f-err").textContent = ""; },
      function () { $("f-err").textContent = "Couldn't read that image. Try a JPEG or PNG (iPhone HEIC photos work in Safari)."; });
  });
  function shrink(file, ok, fail) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var max = live ? 900 : 640;
      var sc = Math.min(1, max / img.naturalWidth), w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { if (!b) return fail(); ok(b, c.toDataURL("image/jpeg", 0.72)); }, "image/jpeg", 0.85);
    };
    img.onerror = function () { URL.revokeObjectURL(url); fail(); };
    img.src = url;
  }
  function slug(brand, model) {
    return (brand + "-" + model).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 6);
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("f-err"); err.textContent = "";
    var brand = form.brand.value.trim(), model = form.model.value.trim();
    if (!brand || !model) { err.textContent = "Brand and model are both needed."; return; }
    var heel = parseFloat(form.heel.value), price = parseFloat(form.price.value);
    var fields = {
      brand: brand.slice(0, 40), model: model.slice(0, 60), heel: isFinite(heel) ? heel : null, price: isFinite(price) ? Math.round(price) : null,
      type: form.type.value, fit: form.fit.value.trim().slice(0, 40), notes: form.notes.value.trim().slice(0, 400)
    };
    var toCatalog = (editingId && shoes[editingId]) || (!editingId && live && isAdmin && $("f-everyone").checked);
    var btn = $("f-submit"), label = btn.textContent; btn.disabled = true; btn.textContent = "Saving…";
    var done = function () { btn.disabled = false; btn.textContent = label; };
    if (toCatalog) { saveCatalogShoe(fields, err).then(done, done); return; }
    if (!editingId && mine.custom.length >= MAX_CUSTOM) { err.textContent = "That's " + MAX_CUSTOM + " custom shoes, the max. Delete one first."; done(); return; }

    var id = editingId || "c-" + slug(brand, model);
    var old = editingId ? mine.custom.filter(function (s) { return s.id === editingId; })[0] : null;
    var photo = Promise.resolve(old ? old.photo : null);
    if (photoBlob && live) {
      var path = uid + "/" + id + "-" + Date.now() + ".jpg";
      photo = sb.storage.from("shoe-photos").upload(path, photoBlob, { contentType: "image/jpeg", upsert: true }).then(function (res) {
        if (res.error) { toast("The photo didn't upload (" + res.error.message + "), so the shoe was saved without it."); return old ? old.photo : null; }
        return sb.storage.from("shoe-photos").getPublicUrl(path).data.publicUrl;
      });
    } else if (photoData) photo = Promise.resolve(photoData);
    photo.then(function (url) {
      fields.id = id; fields.photo = url;
      var s = cleanShoe(fields, true);
      if (!s) { err.textContent = "Couldn't save that shoe."; return; }
      if (old) mine.custom = mine.custom.map(function (x) { return x.id === id ? s : x; });
      else mine.custom.unshift(s);
      changed(); shoeDlg.close(); render(); toast(old ? "Saved " + s.model : s.model + " is on your rack");
    }).then(done, function () { err.textContent = "Couldn't save. Check your connection and try again."; done(); });
  });
  function saveCatalogShoe(row, err) {
    var editing = !!editingId, id = editingId || slug(row.brand, row.model);
    var up = Promise.resolve(null);
    if (photoBlob) {
      var path = uid + "/" + id + "-" + Date.now() + ".jpg";
      up = sb.storage.from("shoe-photos").upload(path, photoBlob, { contentType: "image/jpeg", upsert: true }).then(function (res) {
        if (res.error) return null;
        return sb.storage.from("shoe-photos").getPublicUrl(path).data.publicUrl;
      });
    }
    var dbRow = { brand: row.brand, model: row.model, heel: row.heel, price: row.price, type: row.type, fit: row.fit || null, notes: row.notes || null };
    return up.then(function (url) {
      if (url) dbRow.photo_url = url;
      if (editing) {
        if (shoes[id] && dbRow.heel !== shoes[id].heel) dbRow.heel_label = null;
        return sb.from("shoes").update(dbRow).eq("id", id).select().single();
      }
      dbRow.id = id; dbRow.added_by = uid;
      return sb.from("shoes").insert(dbRow).select().single();
    }).then(function (res) {
      if (res.error) { err.textContent = "Couldn't save: " + res.error.message; return; }
      var s = cleanShoe(res.data, false); if (s) shoes[s.id] = s;
      shoeDlg.close(); render(); toast(editing ? "Saved " + row.model + " for everyone" : row.model + " is on everyone's rack");
    });
  }
  $("btn-add").addEventListener("click", function () { openShoeForm(null); });

  // ---------- sign in ----------
  var siDlg = $("signin-dlg"), siForm = $("signin-form");
  function openSignIn(msg) {
    if (!live) { toast("Accounts turn on once the database is connected."); return; }
    $("si-err").textContent = "";
    $("si-msg").textContent = msg || "Save your list, post it, and vote and comment on other people's.";
    var g = !!CFG.googleSignIn, a = !!CFG.appleSignIn, box = $("oauth");
    $("btn-google").hidden = !g; $("btn-apple").hidden = !a; $("or-line").hidden = !(g || a);
    // Apple first on iPhone, iPad and Mac; Google first everywhere else
    if (APPLE_DEVICE) box.insertBefore($("btn-apple"), box.firstChild); else box.insertBefore($("btn-google"), box.firstChild);
    $("si-submit").disabled = false; $("si-submit").textContent = "Email me a sign-in link";
    siDlg.showModal();
  }
  function redirectUrl() { return location.origin + location.pathname; }
  function oauth(provider) {
    try { sessionStorage.setItem("lt-return-hash", location.hash || ""); } catch (e) {}
    sb.auth.signInWithOAuth({ provider: provider, options: { redirectTo: redirectUrl() } }).then(function (res) {
      if (res.error) $("si-err").textContent = "Couldn't start sign-in: " + res.error.message;
    });
  }
  $("btn-google").addEventListener("click", function () { oauth("google"); });
  $("btn-apple").addEventListener("click", function () { oauth("apple"); });
  siForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("si-email").value.trim(), err = $("si-err");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = "That email doesn't look right."; return; }
    var btn = $("si-submit"); btn.disabled = true; btn.textContent = "Sending…"; err.textContent = "";
    try { sessionStorage.setItem("lt-return-hash", location.hash || ""); } catch (er) {}
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl() } }).then(function (res) {
      if (res.error) { err.textContent = "Couldn't send the link: " + res.error.message; btn.disabled = false; btn.textContent = "Email me a sign-in link"; return; }
      btn.textContent = "Check your email";
      $("si-msg").textContent = "Sent. Open the link in that email on this device and you're in.";
    });
  });

  // ---------- username ----------
  var nameDlg = $("name-dlg"), nameForm = $("name-form");
  function openName() {
    if (!live || !uid) return;
    $("n-err").textContent = "";
    $("n-user").value = mine.username || ""; $("n-name").value = mine.name || "";
    $("n-title").textContent = mine.username ? "Edit your profile." : "Pick a username.";
    nameDlg.showModal();
    setTimeout(function () { $("n-user").focus(); }, 50);
  }
  $("n-user").addEventListener("input", function (e) {
    var v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (v !== e.target.value) e.target.value = v;
  });
  nameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var u = $("n-user").value.trim().toLowerCase(), n = $("n-name").value.trim().slice(0, 30), err = $("n-err");
    if (!USER_RE.test(u)) { err.textContent = "Use 3 to 20 lowercase letters, numbers or underscores."; return; }
    var btn = $("n-submit"); btn.disabled = true; btn.textContent = "Saving…"; err.textContent = "";
    var prev = { username: mine.username, name: mine.name };
    mine.username = u; mine.name = n;
    clearTimeout(saveTimer); dirty = false;
    sb.from("lists").upsert(myRow()).then(function (res) {
      btn.disabled = false; btn.textContent = "Save";
      if (res.error) {
        mine.username = prev.username; mine.name = prev.name;
        err.textContent = res.error.code === "23505" ? "@" + u + " is taken. Try another." : "Couldn't save: " + res.error.message;
        return;
      }
      needName = false; nameDlg.close(); setSave("Saved");
      renderAccount(); render(); loadFeed();
      toast("You're @" + u);
      if (pendingAfterName) { var f = pendingAfterName; pendingAfterName = null; f(); }
    });
  });
  var pendingAfterName = null;
  function requireName(then) {
    if (!live) return false;
    if (!uid) { openSignIn("Sign in first."); return false; }
    if (!mine.username) { pendingAfterName = then || null; openName(); return false; }
    return true;
  }

  // ---------- share and post ----------
  var shareDlg = $("share-dlg");
  function shareUrl() {
    var base = location.origin + location.pathname;
    if (live && uid && mine.username) return base + "#u=" + mine.username;
    var payload = { t: mine.tiers, c: mine.custom.map(function (s) { return { id: s.id, brand: s.brand, model: s.model, heel: s.heel, price: s.price, type: s.type, fit: s.fit }; }) };
    return base + "#s=" + b64url(JSON.stringify(payload));
  }
  function openShare() {
    if (live && uid && !mine.username) { requireName(openShare); return; }
    var canPost = live && uid && mine.username;
    $("post-box").hidden = !canPost;
    $("s-post").checked = !!mine.published; $("s-caption").value = mine.caption || "";
    var note = $("share-note");
    if (canPost) note.textContent = "Anyone with this link sees your list as it is right now, and it keeps up as you change it. Post it to let everyone vote and comment.";
    else if (live) note.innerHTML = "This link carries your whole list in it. <a href=\"#\" id=\"share-signin\">Sign in</a> to get a short link and post to the community.";
    else note.textContent = "This link carries your whole list in it, custom shoes included (their photos stay on this device).";
    $("share-link").value = shareUrl();
    $("btn-native-share").hidden = !navigator.share;
    shareDlg.showModal();
  }
  $("share-note").addEventListener("click", function (e) { if (e.target.id === "share-signin") { e.preventDefault(); shareDlg.close(); openSignIn(); } });
  $("btn-share").addEventListener("click", function () {
    if (!ranked(mine)) { toast("Put at least one shoe on a plate first."); return; }
    openShare();
  });
  $("s-post").addEventListener("change", function (e) {
    mine.published = e.target.checked; dirty = true; flush().then(function () { loadFeed(); renderAccount(); });
    toast(mine.published ? "Posted. The gym can see it now." : "Taken down from the feed.");
  });
  var capTimer = null;
  $("s-caption").addEventListener("input", function (e) {
    mine.caption = e.target.value.slice(0, 140);
    clearTimeout(capTimer); capTimer = setTimeout(function () { dirty = true; flush().then(loadFeed); }, 600);
  });
  function copy(text, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done(); } catch (e) { toast("Copy didn't work. Select the link and copy it."); } ta.remove();
    }
  }
  function listText(l) {
    var P = pool(l), out = [(l.username ? "@" + l.username + "'s" : "My") + " weightlifting shoe tier list"];
    TIERS.forEach(function (t) {
      var names = l.tiers[t.k].filter(function (id) { return P[id]; }).map(function (id) { return P[id].brand + " " + P[id].model; });
      if (names.length) out.push(t.k + " (" + t.name + "): " + names.join(", "));
    });
    return out.join("\n");
  }
  $("btn-copy-link").addEventListener("click", function () { copy($("share-link").value, "Link copied"); });
  $("btn-copy-text").addEventListener("click", function () { copy(listText(mine) + "\n" + $("share-link").value, "List copied as text"); });
  $("btn-native-share").addEventListener("click", function () {
    navigator.share({ title: "My weightlifting shoe tier list", text: listText(mine), url: $("share-link").value }).catch(function () {});
  });

  var resetBtn = $("btn-reset"), resetArmed = false;
  resetBtn.addEventListener("click", function () {
    if (!resetArmed) { resetArmed = true; resetBtn.textContent = "Tap again to rack it all"; setTimeout(function () { resetArmed = false; resetBtn.textContent = "Rack everything"; }, 3000); return; }
    resetArmed = false; resetBtn.textContent = "Rack everything";
    mine.tiers = emptyTiers(); changed(); render(); toast("Everything is back on the rack");
  });

  // ---------- community feed ----------
  var feedEl = $("feed");
  function score(p) { return p.up - p.down; }
  function renderFeed() {
    if (!live) { feedEl.innerHTML = '<p class="empty-note">The community feed turns on once the database is connected. Until then, share your list as a link.</p>'; return; }
    if (!feedLoaded) { feedEl.innerHTML = '<p class="empty-note">Loading posted lists…</p>'; return; }
    if (!feed.length) { feedEl.innerHTML = '<p class="empty-note">Nobody has posted a list yet. Rank some shoes, hit “Share or post”, and be first.</p>'; return; }
    var rows = feed.slice().sort(feedSort === "top"
      ? function (a, b) { return score(b) - score(a) || b.comments - a.comments || (b.updatedAt > a.updatedAt ? 1 : -1); }
      : function (a, b) { return b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0; });
    feedEl.innerHTML = rows.map(function (p) {
      var P = pool(p), tops = [];
      TK.forEach(function (k) { p.tiers[k].forEach(function (id) { if (P[id] && tops.length < 3) tops.push([k, P[id]]); }); });
      return '<button type="button" class="post" data-user="' + esc(p.username) + '">' +
        '<span><span class="who">' + esc(p.name || "@" + p.username) + '</span> <span class="handle">@' + esc(p.username) + (p.userId === uid ? " · you" : "") + "</span></span>" +
        (p.caption ? '<p class="cap">' + esc(p.caption) + "</p>" : "") +
        '<span class="thumbs">' + tops.map(function (t) { return "<figure>" + pic(t[1]) + '<span class="plate sm" data-k="' + t[0] + '">' + t[0] + "</span></figure>"; }).join("") + "</span>" +
        '<span class="stats"><span>▲ ' + p.up + "</span><span>▼ " + p.down + "</span><span>" + p.comments + (p.comments === 1 ? " comment" : " comments") + "</span><span>" + esc(ago(p.updatedAt)) + "</span></span></button>";
    }).join("");
  }
  function loadFeed() {
    if (!live) { renderFeed(); return Promise.resolve(); }
    return sb.from("lists").select("user_id,username,display_name,tiers,custom_shoes,published,caption,updated_at")
      .eq("published", true).not("username", "is", null).order("updated_at", { ascending: false }).limit(60).then(function (res) {
        if (res.error) { feedLoaded = true; feed = []; renderFeed(); return; }
        var posts = res.data.map(function (d) { var l = rowToList(d); l.up = 0; l.down = 0; l.comments = 0; return l; }).filter(function (l) { return ranked(l) > 0; });
        var ids = posts.map(function (p) { return p.userId; });
        if (!ids.length) { feed = []; feedLoaded = true; renderFeed(); renderChrome(); return; }
        return Promise.all([
          sb.from("votes").select("list_id,value").in("list_id", ids).limit(10000),
          sb.from("comments").select("list_id").in("list_id", ids).limit(10000)
        ]).then(function (r) {
          var by = {}; posts.forEach(function (p) { by[p.userId] = p; });
          (r[0].data || []).forEach(function (v) { var p = by[v.list_id]; if (p) { if (v.value > 0) p.up++; else p.down++; } });
          (r[1].data || []).forEach(function (c) { var p = by[c.list_id]; if (p) p.comments++; });
          feed = posts; feedLoaded = true; renderFeed(); renderChrome();
        });
      });
  }
  function setSort(s) { feedSort = s; $("sort-top").setAttribute("aria-pressed", s === "top"); $("sort-new").setAttribute("aria-pressed", s === "new"); renderFeed(); }
  $("sort-top").addEventListener("click", function () { setSort("top"); });
  $("sort-new").addEventListener("click", function () { setSort("new"); });
  feedEl.addEventListener("click", function (e) {
    var p = e.target.closest(".post"); if (!p) return;
    var u = p.dataset.user;
    if (uid && u === mine.username) { goMine(); $("board-sec").scrollIntoView({ behavior: "smooth" }); return; }
    location.hash = "u=" + u;
  });

  // ---------- votes and comments on a list ----------
  var socialEl = $("social");
  function socialTarget() {
    if (!live) return null;
    if (view.mode === "shared" && view.list && view.list.userId) return view.list;
    if (view.mode === "mine" && uid && mine.published && mine.username) { mine.userId = uid; return mine; }
    return null;
  }
  function loadSocial(force) {
    var t = socialTarget();
    if (!t) { social.listId = null; renderSocial(); return; }
    if (!force && social.listId === t.userId) { renderSocial(); return; }
    social = { listId: t.userId, votes: [], comments: [], loading: true };
    renderSocial();
    var id = t.userId;
    Promise.all([
      sb.from("votes").select("voter,value").eq("list_id", id).limit(10000),
      sb.from("comments").select("id,author,author_name,body,created_at").eq("list_id", id).order("created_at", { ascending: true }).limit(300)
    ]).then(function (r) {
      if (social.listId !== id) return;
      social.votes = r[0].data || []; social.comments = r[1].data || []; social.loading = false;
      renderSocial();
    });
  }
  function renderSocial() {
    var t = socialTarget();
    if (!t || social.listId !== t.userId) { socialEl.hidden = true; socialEl.innerHTML = ""; return; }
    socialEl.hidden = false;
    // someone else's list: votes and comments sit above their board; your own: below it
    if (view.mode === "shared" && socialEl.nextElementSibling !== board) board.parentNode.insertBefore(socialEl, board);
    else if (view.mode === "mine" && board.nextElementSibling !== socialEl) board.parentNode.insertBefore(socialEl, board.nextSibling);
    var up = 0, down = 0, myVote = 0;
    social.votes.forEach(function (v) { if (v.value > 0) up++; else down++; if (v.voter === uid) myVote = v.value; });
    var own = t.userId === uid;
    var head = '<div class="social-head"><h3>' + (own ? "Your posted list" : esc(t.name ? t.name + " (@" + t.username + ")" : "@" + t.username)) + "</h3>" +
      '<div class="votes" role="group" aria-label="Vote on this list">' +
      '<button type="button" class="vote up" data-vote="1" aria-pressed="' + (myVote === 1) + '"' + (own ? " disabled" : "") + ' aria-label="Like">▲ <span>' + up + "</span></button>" +
      '<button type="button" class="vote down" data-vote="-1" aria-pressed="' + (myVote === -1) + '"' + (own ? " disabled" : "") + ' aria-label="Dislike">▼ <span>' + down + "</span></button></div>" +
      (t.caption ? '<p class="caption">' + esc(t.caption) + "</p>" : "") + "</div>";
    var list = social.loading ? '<p class="form-note">Loading comments…</p>' :
      (social.comments.length ? '<ul class="comments">' + social.comments.map(function (c) {
        var canDel = uid && (c.author === uid || own || isAdmin);
        return '<li class="comment"><span class="who">@' + esc(c.author_name || "lifter") + ' <time datetime="' + esc(c.created_at) + '">' + esc(ago(c.created_at)) + "</time></span><p>" + esc(c.body) + "</p>" +
          (canDel ? '<button type="button" class="del" data-del="' + esc(String(c.id)) + '">Delete</button>' : "") + "</li>";
      }).join("") + "</ul>" : '<p class="form-note">No comments yet. Start the argument.</p>');
    var box = uid && mine.username
      ? '<form class="comment-form" id="comment-form"><textarea id="c-body" maxlength="500" rows="2" placeholder="' + (own ? "Reply to the gym…" : "Say something about @" + esc(t.username) + "'s picks…") + '" aria-label="Write a comment"></textarea><button class="btn red" type="submit">Post</button></form>'
      : '<button class="btn" type="button" data-act="comment-signin">' + (uid ? "Pick a username to comment" : "Sign in to vote and comment") + "</button>";
    socialEl.innerHTML = head + list + box;
  }
  socialEl.addEventListener("click", function (e) {
    var t = socialTarget(); if (!t) return;
    var v = e.target.closest("[data-vote]");
    if (v) {
      if (!requireName(function () { renderSocial(); })) return;
      var val = +v.dataset.vote, current = 0, id = t.userId;
      social.votes.forEach(function (x) { if (x.voter === uid) current = x.value; });
      var req = current === val ? sb.from("votes").delete().eq("list_id", id).eq("voter", uid)
        : sb.from("votes").upsert({ list_id: id, voter: uid, value: val });
      // update right away, then confirm with the server
      social.votes = social.votes.filter(function (x) { return x.voter !== uid; });
      if (current !== val) social.votes.push({ voter: uid, value: val });
      renderSocial();
      req.then(function (res) { if (res.error) { toast("Vote didn't count: " + res.error.message); loadSocial(true); } else loadFeed(); });
      return;
    }
    var d = e.target.closest("[data-del]");
    if (d) {
      if (d.dataset.armed !== "1") { d.dataset.armed = "1"; d.textContent = "Tap again to delete"; return; }
      sb.from("comments").delete().eq("id", d.dataset.del).then(function (res) {
        if (res.error) { toast("Couldn't delete it: " + res.error.message); return; }
        social.comments = social.comments.filter(function (c) { return String(c.id) !== d.dataset.del; }); renderSocial(); loadFeed();
      });
      return;
    }
    if (e.target.closest('[data-act="comment-signin"]')) requireName(function () { renderSocial(); });
  });
  socialEl.addEventListener("submit", function (e) {
    if (e.target.id !== "comment-form") return;
    e.preventDefault();
    var t = socialTarget(), ta = $("c-body"), body = ta.value.trim();
    if (!t || !body) return;
    var btn = e.target.querySelector("button"); btn.disabled = true;
    sb.from("comments").insert({ list_id: t.userId, author: uid, body: body.slice(0, 500) }).select().single().then(function (res) {
      btn.disabled = false;
      if (res.error) { toast("Comment didn't post: " + res.error.message); return; }
      social.comments.push(res.data); renderSocial(); loadFeed();
    });
  });
  socialEl.addEventListener("keydown", function (e) {
    if (e.target.id === "c-body" && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  // ---------- routing ----------
  $("btn-back").addEventListener("click", goMine);
  function goMine() {
    view = { mode: "mine", list: null };
    if (location.hash) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; } }
    render(); loadSocial();
  }
  function showShared(l) { view = { mode: "shared", list: l }; render(); loadSocial(); $("board-sec").scrollIntoView({ behavior: "smooth" }); }
  function applyHash() {
    var h = location.hash || "";
    var u = /^#u=([a-z0-9_]{3,20})$/.exec(h);
    if (u) {
      if (!live) { toast("Profile links need the shared database, which isn't connected here."); return; }
      if (uid && u[1] === mine.username) { goMine(); return; }
      sb.from("lists").select("user_id,username,display_name,tiers,custom_shoes,published,caption,updated_at").eq("username", u[1]).maybeSingle().then(function (res) {
        if (res.error || !res.data) { toast("Couldn't find @" + u[1] + "."); return; }
        if (res.data.user_id === uid) { goMine(); return; }
        showShared(rowToList(res.data));
      });
      return;
    }
    var s = /^#s=([A-Za-z0-9_-]{1,12000})$/.exec(h);
    if (s) {
      try {
        var d = JSON.parse(unb64url(s[1]));
        var payload = d && d.t ? d : { t: d, c: [] };
        var custom = cleanCustom((payload.c || []).map(function (x) { var y = {}; for (var k in x) if (k !== "photo") y[k] = x[k]; return y; }));
        showShared({ userId: null, username: "", name: "", tiers: cleanTiers(payload.t), custom: custom, published: false, caption: "" });
      } catch (e) { toast("That share link is broken."); }
      return;
    }
    if (/^#list-/.test(h)) { toast("That's an old share link. Ask for a new one."); return; }
    if (view.mode === "shared") { view = { mode: "mine", list: null }; render(); loadSocial(); }
  }
  window.addEventListener("hashchange", applyHash);

  var toastEl = $("toast"), toastTimer = null;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600); }

  // ---------- data loading ----------
  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) for (var i = 0; i < OLD_LOCAL_KEYS.length && !raw; i++) raw = localStorage.getItem(OLD_LOCAL_KEYS[i]);
      if (raw) { var d = JSON.parse(raw); mine.tiers = cleanTiers(d.tiers); mine.custom = live ? [] : cleanCustom(d.custom); }
    } catch (e) {}
  }
  function loadShoesFromFile() {
    return fetch("data/shoes.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (arr) {
      shoes = {}; (arr || []).forEach(function (d) { var s = cleanShoe(d, false); if (s) shoes[s.id] = s; });
    });
  }
  function loadShoesFromDb() {
    return sb.from("shoes").select("*").limit(1000).then(function (res) {
      if (res.error) throw res.error;
      var next = {}; res.data.forEach(function (d) { var s = cleanShoe(d, false); if (s) next[s.id] = s; }); shoes = next;
    });
  }
  function onSignedIn(newUid) {
    if (uid === newUid) return;
    uid = newUid;
    var localTiers = mine.tiers;
    sb.rpc("is_admin").then(function (r) { isAdmin = !r.error && r.data === true; render(); });
    sb.from("lists").select("user_id,username,display_name,tiers,custom_shoes,published,caption,updated_at").eq("user_id", uid).maybeSingle().then(function (res) {
      if (res.data) {
        mine = rowToList(res.data);
        if (!ranked(mine) && ranked({ tiers: localTiers, custom: [] })) { mine.tiers = localTiers; dirty = true; flush(); }
      } else {
        mine = emptyList(); mine.tiers = localTiers;
        if (ranked(mine)) { dirty = true; flush(); }
      }
      mine.userId = uid;
      renderAccount(); render(); loadSocial();
      var back = null; try { back = sessionStorage.getItem("lt-return-hash"); sessionStorage.removeItem("lt-return-hash"); } catch (e) {}
      if (back && !location.hash) location.hash = back.replace(/^#/, ""); else applyHash();
      if (!mine.username) { needName = true; if (!document.querySelector("dialog[open]")) openName(); }
    });
  }
  function onSignedOut() {
    uid = null; isAdmin = false; mine = emptyList(); loadLocal(); setSave(""); renderAccount(); render(); loadSocial();
  }

  function startPreview() {
    live = false; loadLocal(); renderAccount(); renderFeed();
    loadShoesFromFile().catch(function () { shoes = {}; }).then(function () { shoesLoaded = true; render(); applyHash(); });
  }
  function startLive() {
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
    } catch (e) { startPreview(); return; }
    live = true; loadLocal(); renderAccount(); render(); renderFeed();
    loadShoesFromDb().then(function () {
      shoesLoaded = true; render(); applyHash(); loadFeed();
    }, function () {
      live = false; sb = null;
      toast("The database didn't answer, so this is running in preview mode.");
      startPreview();
    });
    sb.auth.onAuthStateChange(function (event, sess) {
      if (sess && sess.user) { if (siDlg.open) siDlg.close(); onSignedIn(sess.user.id); }
      else if (event === "SIGNED_OUT") onSignedOut();
      if (/[?&]code=/.test(location.search)) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }
      renderAccount();
    });
    var lastRefresh = Date.now();
    window.addEventListener("focus", function () {
      if (!live || !sb || Date.now() - lastRefresh < 20000 || drag) return;
      lastRefresh = Date.now();
      loadShoesFromDb().then(function () { render(); loadFeed(); loadSocial(true); }, function () {});
    });
  }

  render();
  if (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient) startLive();
  else startPreview();
})();
