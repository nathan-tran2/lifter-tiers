// Rotating lift videos behind the page. Each one plays muted from YouTube, then crossfades to the next lifter.
(function () {
  "use strict";
  var LIFTS = [
    { id: "nrgnH9fTfGo", who: "Lasha Talakhadze", what: "225 kg snatch world record, 2021 World Championships", ch: "All Things Gym" },
    { id: "CKGvRzLgQX0", who: "Karlos Nasar", what: "220 kg clean & jerk world record, 2022 World Championships", ch: "All Things Gym" },
    { id: "OCmfxdyOoTE", who: "Lu Xiaojun", what: "160 kg snatch in the 2018 Worlds training hall", ch: "All Things Gym" },
    { id: "BL18-SEIb5A", who: "Shi Zhiyong", what: "164 kg snatch, 2018 World Championships", ch: "All Things Gym" },
    { id: "3uiUj534CaA", who: "Dmitry Klokov", what: "242 kg clean & jerk in training", ch: "Elite Athletes" },
    { id: "LzsZsFyRKOc", who: "Kianoush Rostami", what: "220 kg clean & jerk world record, Fajr Cup", ch: "Ervin Roznjik" },
    { id: "fDGybYKVVo4", who: "Olivia Reeves", what: "123 kg snatch world record", ch: "Weightlifting House" },
    { id: "VGniqOhUbbU", who: "Ilya Ilyin", what: "246 kg clean & jerk world record, 2015 President's Cup", ch: "All Things Gym" },
    { id: "QqU1szz-59Y", who: "Li Dayin", what: "170 kg snatch", ch: "Weightlifting House" }
  ];
  var HOLD = 28000;           // how long each lifter stays up
  var stage = document.getElementById("stage");
  if (!stage) return;
  var $ = function (id) { return document.getElementById(id); };
  var who = $("v-who"), what = $("v-what"), bar = $("v-bar"), chips = $("v-chips"), credit = $("v-credit"), playBtn = $("v-play");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var idx = Math.floor(Math.random() * LIFTS.length);
  var playing = !reduce, current = null, startedAt = 0, elapsed = 0, raf = 0;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function src(id) {
    return "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&mute=1&controls=0&loop=1&playlist=" + id +
      "&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&enablejsapi=1&origin=" + encodeURIComponent(location.origin);
  }
  function command(frame, fn) {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: fn, args: [] }), "*"); } catch (e) {}
  }

  chips.innerHTML = LIFTS.map(function (l, i) {
    return '<button type="button" class="lchip" role="tab" data-i="' + i + '" aria-selected="false">' + esc(l.who) + "</button>";
  }).join("");

  function label() {
    var l = LIFTS[idx];
    who.textContent = l.who; what.textContent = l.what;
    credit.innerHTML = 'Video: <a href="https://www.youtube.com/watch?v=' + l.id + '" target="_blank" rel="noopener">' + esc(l.ch) + " on YouTube</a>";
    Array.prototype.forEach.call(chips.children, function (c, i) {
      c.setAttribute("aria-selected", i === idx ? "true" : "false");
      if (i === idx && c.scrollIntoView && chips.scrollWidth > chips.clientWidth) {
        chips.scrollTo({ left: c.offsetLeft - chips.clientWidth / 2 + c.offsetWidth / 2, behavior: reduce ? "auto" : "smooth" });
      }
    });
  }

  function show(i) {
    idx = (i + LIFTS.length) % LIFTS.length;
    label();
    elapsed = 0; startedAt = performance.now();
    if (!playing) { bar.style.width = "0%"; return; }
    var old = current;
    var f = document.createElement("iframe");
    f.title = LIFTS[idx].who + " lifting";
    f.allow = "autoplay; encrypted-media; picture-in-picture";
    f.setAttribute("tabindex", "-1");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.src = src(LIFTS[idx].id);
    f.addEventListener("load", function () {
      // give the player a moment to start before fading it in
      setTimeout(function () {
        if (current !== f) return;
        f.classList.add("on");
        if (old) setTimeout(function () { old.remove(); }, 1300);
      }, 900);
    });
    stage.appendChild(f);
    current = f;
    // drop any extra frames left from fast clicking
    Array.prototype.forEach.call(stage.querySelectorAll("iframe"), function (x) { if (x !== f && x !== old) x.remove(); });
  }

  function tick(now) {
    if (playing) {
      var t = elapsed + (now - startedAt);
      bar.style.width = Math.min(100, t / HOLD * 100) + "%";
      if (t >= HOLD) show(idx + 1);
    }
    raf = requestAnimationFrame(tick);
  }

  function setPlaying(p) {
    if (p === playing) return;
    playing = p;
    playBtn.textContent = p ? "❚❚" : "►";
    playBtn.setAttribute("aria-label", p ? "Pause videos" : "Play videos");
    if (p) {
      startedAt = performance.now();
      if (!current) show(idx); else command(current, "playVideo");
    } else {
      elapsed += performance.now() - startedAt;
      command(current, "pauseVideo");
    }
  }

  $("v-prev").addEventListener("click", function () { show(idx - 1); });
  $("v-next").addEventListener("click", function () { show(idx + 1); });
  playBtn.addEventListener("click", function () { setPlaying(!playing); });
  chips.addEventListener("click", function (e) {
    var c = e.target.closest(".lchip"); if (!c) return;
    if (!playing) setPlaying(true);
    show(+c.dataset.i);
  });
  var pausedByHide = false;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && playing) { pausedByHide = true; setPlaying(false); }
    else if (!document.hidden && pausedByHide) { pausedByHide = false; setPlaying(true); }
  });

  if (!playing) { playBtn.textContent = "►"; playBtn.setAttribute("aria-label", "Play videos"); }
  show(idx);
  raf = requestAnimationFrame(tick);
})();
