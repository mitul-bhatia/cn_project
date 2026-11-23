/* Break-it-yourself simulator. Mirrors what the real project does:
   DNS failover (Ext A), backend failover (Ext D), standby edge + DNS cutover (Ext E), firewall (Ext C). */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var svg = document.getElementById("sim");
  if (!svg) return;

  var NODES = {
    client: { x: 20, y: 170, w: 130, h: 76, t: "Client", s: "curl / browser", c: "client" },
    d1: { x: 230, y: 14, w: 190, h: 62, t: "DNS", s: "dnsmasq · primary", c: "dns" },
    d2: { x: 230, y: 96, w: 190, h: 62, t: "Backup DNS", s: "same records", c: "spare" },
    e1: { x: 330, y: 180, w: 190, h: 70, t: "nginx edge", s: "primary · :8443", c: "edge" },
    e2: { x: 330, y: 320, w: 190, h: 70, t: "Standby edge", s: "spare · same cert", c: "spare" },
    a: { x: 690, y: 110, w: 190, h: 64, t: "Backend A", s: "port 3001", c: "be" },
    b: { x: 690, y: 240, w: 190, h: 64, t: "Backend B", s: "port 3002", c: "be" }
  };
  var EDGES = {
    "c-d1": "M85 170V45H230",
    "c-d2": "M110 170V127H230",
    "c-e1": "M150 208H330",
    "c-e2": "M120 246V355H330",
    "e1-a": "M520 205C610 205 600 130 690 130",
    "e1-b": "M520 225C610 225 600 255 690 255",
    "e2-a": "M520 345C640 345 590 150 690 150",
    "e2-b": "M520 365C640 365 600 285 690 285"
  };

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ---- draw once ---- */
  svg.setAttribute("viewBox", "0 0 900 410");
  var fwBox = el("rect", { x: 672, y: 92, width: 226, height: 226, rx: 16, "class": "fwbox" }, svg);
  var fwLbl = el("text", { x: 676, y: 340, "class": "fwl" }, svg);
  fwLbl.textContent = "Firewall: only the edge may enter";
  var edgeEls = {};
  Object.keys(EDGES).forEach(function (id) { edgeEls[id] = el("path", { d: EDGES[id], "class": "ed" }, svg); });
  var nodeEls = {};
  Object.keys(NODES).forEach(function (id) {
    var n = NODES[id];
    var g = el("g", { "class": "node " + n.c }, svg);
    el("rect", { x: n.x, y: n.y, width: n.w, height: n.h, rx: 12 }, g);
    var t = el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 - 3, "class": "t" }, g); t.textContent = n.t;
    var s = el("text", { x: n.x + n.w / 2, y: n.y + n.h / 2 + 17, "class": "s" }, g); s.textContent = n.s;
    nodeEls[id] = { g: g, s: s };
  });
  var l1 = el("text", { x: 20, y: 290, "class": "lbl" }, svg); l1.textContent = "Amber line = the path of the last request";
  var l2 = el("text", { x: 20, y: 312, "class": "lbl" }, svg); l2.textContent = "Red dashed = tried, no answer";

  /* ---- state ---- */
  var S;
  function fresh() { return { dns1: true, a: true, b: true, e1: true, fw: false, answer: "primary", rr: 0, pending: false, sent: [] }; }
  S = fresh();
  var timer = null;

  var $ = function (id) { return document.getElementById(id); };
  var verdict = $("verdict"), vBig = $("vbig"), vSub = $("vsub"), chipsEl = $("chips"), storyEl = $("story"), realEl = $("real"), ttlEl = $("ttl"), ttlBar = $("ttlbar"), ttlTxt = $("ttltxt");

  function setReal(cmd, ext) {
    realEl.innerHTML = "";
    var s = document.createElement("span"); s.textContent = "In the real project (" + ext + "): ";
    var c = document.createElement("code"); c.textContent = cmd;
    realEl.appendChild(s); realEl.appendChild(c);
  }

  function paintNodes(hit) {
    var down = { d1: !S.dns1, e1: !S.e1, a: !S.a, b: !S.b };
    Object.keys(nodeEls).forEach(function (id) {
      var cls = "node " + NODES[id].c + (down[id] ? " down" : "") + (hit && hit.indexOf(id) > -1 ? " hit" : "");
      nodeEls[id].g.setAttribute("class", cls);
    });
    nodeEls.d1.s.textContent = S.dns1 ? "dnsmasq · primary" : "STOPPED";
    nodeEls.e1.s.textContent = S.e1 ? "primary · :8443" : "STOPPED";
    nodeEls.a.s.textContent = S.a ? "port 3001" : "STOPPED";
    nodeEls.b.s.textContent = S.b ? "port 3002" : "STOPPED";
    nodeEls.e2.s.textContent = S.answer === "standby" ? "ACTIVE · DNS points here" : "spare · same cert";
    fwBox.setAttribute("class", "fwbox" + (S.fw ? " on" : ""));
    fwLbl.setAttribute("class", "fwl" + (S.fw ? " on" : ""));
  }
  function paintEdges(on, bad) {
    Object.keys(edgeEls).forEach(function (id) {
      var c = "ed";
      if (bad && bad.indexOf(id) > -1) c += " bad";
      else if (on && on.indexOf(id) > -1) c += " on";
      edgeEls[id].setAttribute("class", c);
    });
  }

  function route() {
    var steps = [], on = [], bad = [], hit = ["client"], res;
    if (S.dns1) { on.push("c-d1"); hit.push("d1"); steps.push([false, "The client asks DNS for the name. The primary DNS answers."]); }
    else {
      bad.push("c-d1"); on.push("c-d2"); hit.push("d2");
      steps.push([false, "The primary DNS is silent (timeout), so the client asks the backup DNS. It has the same records, so the name still resolves."]);
    }
    var eid = S.answer === "primary" ? "e1" : "e2";
    steps.push([false, "The answer points to the " + (eid === "e1" ? "primary" : "standby") + " edge."]);
    if (eid === "e1" && !S.e1) {
      bad.push("c-e1"); hit.push("e1");
      steps.push([true, "The client connects to the primary edge and nobody answers. Timeout. Every user is stuck, even though both backends are healthy."]);
      return { steps: steps, on: on, bad: bad, hit: hit, cls: "fail", big: "No answer", sub: "The edge is down", chip: "x" };
    }
    on.push("c-" + eid); hit.push(eid);
    var up = []; if (S.a) up.push("a"); if (S.b) up.push("b");
    if (!up.length) {
      bad.push(eid + "-a", eid + "-b");
      steps.push([true, "nginx is up, but both backends are stopped. It answers 502 Bad Gateway."]);
      return { steps: steps, on: on, bad: bad, hit: hit, cls: "fail", big: "HTTP 502", sub: "No backend answered", chip: "x" };
    }
    var pick = up[S.rr % up.length]; S.rr++;
    if (up.length === 1) steps.push([false, "nginx notices Backend " + (S.a ? "B" : "A") + " is down, retries on Backend " + pick.toUpperCase() + ", and the user sees no error."]);
    else steps.push([false, "nginx picks Backend " + pick.toUpperCase() + " (round robin: A, B, A, B)."]);
    on.push(eid + "-" + pick); hit.push(pick);
    if (!S.a) bad.push(eid + "-a");
    if (!S.b) bad.push(eid + "-b");
    return { steps: steps, on: on, bad: bad, hit: hit, cls: "ok", big: "HTTP 200", sub: "Answered by Backend " + pick.toUpperCase(), chip: pick };
  }

  function show(r) {
    paintNodes(r.hit); paintEdges(r.on, r.bad);
    verdict.className = "verdict " + r.cls;
    vBig.textContent = r.big; vSub.textContent = r.sub;
    storyEl.innerHTML = "";
    r.steps.forEach(function (st, i) {
      var li = document.createElement("li"); li.setAttribute("data-n", String(i + 1));
      if (st[0]) li.className = "bad";
      li.textContent = st[1]; storyEl.appendChild(li);
    });
  }
  function addChip(k) {
    S.sent.push(k); if (S.sent.length > 12) S.sent.shift();
    chipsEl.innerHTML = "";
    S.sent.forEach(function (c) {
      var d = document.createElement("span"); d.className = "chip " + c;
      d.textContent = c === "x" ? "✕" : c.toUpperCase(); d.setAttribute("aria-label", c === "x" ? "failed" : "backend " + c);
      chipsEl.appendChild(d);
    });
  }
  function sendOne() { var r = route(); show(r); addChip(r.chip); return r; }

  /* ---- controls ---- */
  function press(btn, on) { btn.setAttribute("aria-pressed", on ? "true" : "false"); }
  var B = {
    dns: $("t-dns"), a: $("t-a"), b: $("t-b"), e1: $("t-e1"), fw: $("t-fw"),
    cut: $("b-cut"), send: $("b-send"), six: $("b-six"), direct: $("b-direct"), reset: $("b-reset")
  };

  B.dns.addEventListener("click", function () {
    S.dns1 = !S.dns1; press(B.dns, !S.dns1); setReal("./bin/phase2 dns-failover", "Extension A"); sendOne();
  });
  B.a.addEventListener("click", function () {
    S.a = !S.a; press(B.a, !S.a); setReal("./bin/phase2 failover", "Extension D"); sendOne();
  });
  B.b.addEventListener("click", function () {
    S.b = !S.b; press(B.b, !S.b); setReal("./bin/phase2 failover b", "Extension D"); sendOne();
  });
  B.e1.addEventListener("click", function () {
    S.e1 = !S.e1; press(B.e1, !S.e1); setReal("./bin/phase2 cutover", "Extension E"); sendOne();
  });
  B.fw.addEventListener("click", function () {
    S.fw = !S.fw; press(B.fw, S.fw); setReal("./bin/phase2 isolate on", "Extension C"); paintNodes(null);
    storyEl.innerHTML = "";
    var li = document.createElement("li"); li.setAttribute("data-n", "1");
    li.textContent = S.fw ? "Firewall on each backend Mac: only the edge may reach ports 3001 and 3002. Now press “Client tries a backend directly”." : "Firewall off: any machine on the network can reach the backends directly.";
    storyEl.appendChild(li);
  });
  B.direct.addEventListener("click", function () {
    setReal("./bin/phase2 isolate test", "Extension C");
    paintNodes(["client", "a"]); paintEdges([], []);
    verdict.className = "verdict " + (S.fw ? "ok" : "warn");
    vBig.textContent = S.fw ? "Dropped" : "Reached";
    vSub.textContent = S.fw ? "No reply. The client times out." : "Anyone can skip the edge";
    storyEl.innerHTML = "";
    var li = document.createElement("li"); li.setAttribute("data-n", "1");
    li.textContent = S.fw
      ? "The client skips the edge and connects straight to Backend A. The firewall allows only the edge, so the packet is dropped. No answer, no error: just a timeout."
      : "The client skips the edge and talks to Backend A directly. Nothing stops it, so the edge and its TLS can be bypassed. This is why Extension C exists.";
    storyEl.appendChild(li);
  });
  B.cut.addEventListener("click", function () {
    setReal("./bin/phase2 cutover", "Extension E");
    var target = S.answer === "primary" ? "standby" : "primary";
    S.pending = true; B.cut.disabled = true; ttlEl.hidden = false;
    var t0 = Date.now(), total = 4000;
    ttlTxt.textContent = "DNS record changed. Clients keep the old answer until the TTL ends (30 s in the real demo, sped up here).";
    storyEl.innerHTML = "";
    var li = document.createElement("li"); li.setAttribute("data-n", "1");
    li.textContent = "While the old answer is still cached, requests still go to the " + (S.answer === "primary" ? "primary" : "standby") + " edge. Press “Send request” now to see it.";
    storyEl.appendChild(li);
    timer = setInterval(function () {
      var p = Math.min(1, (Date.now() - t0) / total);
      ttlBar.style.width = (p * 100) + "%";
      if (p >= 1) {
        clearInterval(timer); timer = null; S.answer = target; S.pending = false; B.cut.disabled = false;
        B.cut.textContent = S.answer === "primary" ? "Move DNS to the standby edge" : "Move DNS back to the primary edge";
        ttlTxt.textContent = "TTL over. New lookups now go to the " + target + " edge."; sendOne();
      }
    }, 80);
  });
  B.send.addEventListener("click", function () { sendOne(); });
  B.six.addEventListener("click", function () { for (var i = 0; i < 6; i++) sendOne(); });
  B.reset.addEventListener("click", function () {
    if (timer) { clearInterval(timer); timer = null; }
    S = fresh(); [B.dns, B.a, B.b, B.e1, B.fw].forEach(function (b) { press(b, false); });
    B.cut.disabled = false; B.cut.textContent = "Move DNS to the standby edge"; ttlEl.hidden = true; ttlBar.style.width = "0";
    chipsEl.innerHTML = ""; setReal("./bin/phase2 test", "everything");
    sendOne(); sendOne();
  });

  setReal("./bin/phase2 test", "everything"); ttlEl.hidden = true;
  sendOne(); sendOne();
})();

/* ---- stepper, copy buttons, command filter ---- */
(function () {
  var tabs = document.querySelectorAll(".step");
  var panels = document.querySelectorAll(".spanel");
  function pick(i) {
    tabs.forEach(function (t, k) { t.setAttribute("aria-selected", k === i ? "true" : "false"); });
    panels.forEach(function (p, k) { p.hidden = k !== i; });
  }
  tabs.forEach(function (t, i) { t.addEventListener("click", function () { pick(i); }); });
  if (tabs.length) pick(0);

  document.addEventListener("click", function (e) {
    var b = e.target.closest(".copy"); if (!b) return;
    var txt = b.parentElement.querySelector("code").textContent;
    function ok() { b.textContent = "Copied"; b.classList.add("done"); setTimeout(function () { b.textContent = "Copy"; b.classList.remove("done"); }, 1400); }
    function fb() { var a = document.createElement("textarea"); a.value = txt; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (x) { } a.remove(); ok(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, fb); else fb();
  });

  var q = document.getElementById("q");
  if (q) q.addEventListener("input", function () {
    var v = q.value.toLowerCase();
    document.querySelectorAll("#tbl tbody tr").forEach(function (r) { r.style.display = r.textContent.toLowerCase().indexOf(v) > -1 ? "" : "none"; });
  });
})();
