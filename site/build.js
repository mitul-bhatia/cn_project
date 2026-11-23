const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const GH = "https://github.com/mitul-bhatia/cn_project";
const HERE = __dirname;
const OUT = process.argv[2];

/* Line numbers are looked up in the real code at build time, so they cannot go stale silently. */
function L(file, needle, nth = 1) {
  const lines = fs.readFileSync(path.join(REPO, file), "utf8").split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const hit = needle instanceof RegExp ? needle.test(lines[i]) : lines[i].includes(needle);
    if (hit && ++seen === nth) return i + 1;
  }
  throw new Error(`not found in ${file}: ${needle}`);
}
const exists = (f) => { if (!fs.existsSync(path.join(REPO, f))) throw new Error("missing file " + f); return f; };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ref = (file, needle) => {
  exists(file);
  const line = needle ? L(file, needle) : "";
  const href = `${GH}/blob/main/${file}${line ? "#L" + line : ""}`;
  return `<a class="ref" href="${href}" target="_blank" rel="noopener"><span>${file}</span>${line ? `<b>:${line}</b>` : ""}</a>`;
};
const refs = (list) => `<div class="refs">${list.map(([f, n]) => ref(f, n)).join("")}</div>`;
const cmd = (t) => {
  const [c, note] = t.split(/\s{2,}#\s*/);
  return `<div class="cmdw"><div class="cmd"><code>${esc(c.trim())}</code><button type="button" class="copy" aria-label="Copy command">Copy</button></div>${note ? `<small style="color:var(--muted);font-size:12px">${esc(note)}</small>` : ""}</div>`;
};

/* ---------------------------------------------------------------- content */
const T = {
  nginx: "config/nginx/nginx.conf.template",
  dns: "config/dns/dnsmasq.conf.template",
  roles: "scripts/roles.sh",
  p2: "scripts/phase2.sh",
  srv: "backends/server.py",
  ca: "scripts/create-local-ca.sh",
};

const team = [
  ["Mac 1", "Mitul", "DNS server, test client, controller", "macs/mac1-mitul/README.md"],
  ["Mac 2", "Hardik", "nginx edge: TLS, proxy, load balancer", "macs/mac2-hardik/README.md"],
  ["Mac 3", "Vaibhav", "Backend A, port 3001", "macs/mac3-vaibhav/README.md"],
  ["Mac 4", "Akshat", "Backend B, port 3002", "macs/mac4-akshat/README.md"],
];

const stations = [
  { k: "1 · Name", h: "DNS", analogy: "Look the shop up in a phone book.",
    what: "Our own DNS server (dnsmasq) turns app.team1.test into the edge Mac's address. It only answers for .test names and never forwards to the internet.",
    cmd: "dig @<DNS_IP> app.team1.test", see: "app.team1.test.   300   IN   A   <edge-ip>",
    refs: [[T.dns, "address=/@@APP_DOMAIN@@"], [T.roles, "dns_start() {"], [T.roles, "resolver_install() {"]] },
  { k: "2 · Door", h: "TCP", analogy: "Walk up and knock three times.",
    what: "The client opens a TCP connection to the edge on port 8443: SYN, SYN-ACK, ACK. If nothing is listening, the knock is refused.",
    cmd: "nc -vz <EDGE_IP> 8443", see: "Connection to <EDGE_IP> port 8443 ... succeeded!",
    refs: [[T.nginx, "listen @@EDGE_PORT@@"], ["scripts/checks.sh", "chk_edge_tcp()"]] },
  { k: "3 · ID check", h: "TLS", analogy: "The shop shows an ID card signed by an authority you trust.",
    what: "Our own CA signed a certificate for app.team1.test and api.team1.test. Clients trust that CA, so there is no curl -k anywhere.",
    cmd: "openssl s_client -connect <EDGE_IP>:8443 -servername app.team1.test -CAfile pki/ca.crt", see: "Verify return code: 0 (ok)",
    refs: [[T.ca, "subjectAltName"], ["scripts/install-ca.sh", "add-trusted-cert"], [T.nginx, "ssl_certificate "]] },
  { k: "4 · Reception", h: "nginx", analogy: "Reception takes your order and picks a kitchen.",
    what: "nginx ends the TLS session, then forwards the request to Backend A or Backend B in turn. That is a reverse proxy with round-robin load balancing.",
    cmd: "for i in 1 2 3 4; do curl -s https://app.team1.test:8443/api/status; echo; done", see: "backend A, then B, then A, then B",
    refs: [[T.nginx, "upstream project_backends"], [T.roles, "edge_start() {"]] },
  { k: "5 · Kitchen", h: "Backend", analogy: "The kitchen cooks the answer and signs it A or B.",
    what: "One tiny Python server. Every reply carries an X-Backend header, so you can always see which kitchen answered.",
    cmd: "curl -i https://app.team1.test:8443/api/status", see: '{"backend": "A", "owner": "...", "status": "ok"}\nX-Backend: A',
    refs: [[T.srv, 'elif path == "/api/status"'], [T.srv, "BIND ="]] },
];

const tasks = [
  ["A", "LAN", "All Macs on one Wi-Fi. IP, MAC and gateway recorded. Pairwise ping.", [["scripts/macos-network-info.sh", ""]]],
  ["B", "DNS", "dnsmasq answers app and api names with the edge IP.", [[T.dns, "address=/@@APP_DOMAIN@@"], ["tests/test_dns.sh", ""]]],
  ["C", "Backends", "A on :3001, B on :3002, both with X-Backend.", [[T.srv, 'elif path == "/api/status"'], ["tests/test_backends.sh", ""]]],
  ["D", "Edge + balancer", "One name, one door, round robin A, B, A, B.", [[T.nginx, "upstream project_backends"], ["tests/test_load_balancing.sh", ""]]],
  ["E", "TLS", "Own CA, certificate with both names, trusted by clients.", [[T.ca, "subjectAltName"], ["tests/test_tls.sh", ""]]],
  ["F", "Caching", "Cache-Control, ETag and 304 Not Modified.", [[T.srv, 'elif path == "/api/cacheable"'], ["tests/test_cache.sh", ""]]],
  ["G", "Packets", "Capture DNS, TCP and TLS handshakes for Wireshark.", [["scripts/capture-packets.sh", ""], ["bin/collect-evidence", ""]]],
];

const receipts = [
  { k: "A", t: "Backup DNS", tag: ["Recorded run", ""], p: "Primary DNS stopped. The backup answered, so the site kept working.",
    term: `<span class="p">$ dig @primary-dns app.team1.test</span>\n<span class="r">;; connection timed out; no servers could be reached</span>\n<span class="p">$ dig @backup-dns app.team1.test</span>\napp.team1.test.  300  IN  A  &lt;edge-ip&gt;\n<span class="p">$ curl https://app.team1.test:8443/api/status</span>\n<span class="g">http=200</span>\n<span class="g">PASS: still resolves with the primary DNS down</span>`,
    cmd: "./bin/phase2 dns-failover", refs: [[T.p2, "p2_demo_dns_failover() {"]] },
  { k: "B", t: "TTL and cache", tag: ["Recorded run", ""], p: "TTL 30 s. The server knew the new IP at once. The client kept the old one for 39 s.",
    term: `<span class="d">record changed: old edge -> standby edge</span>\nserver (dig)     : <span class="g">standby</span>\nclient (cached)  : <span class="r">old edge</span>\nt+36s  client = old edge\nt+39s  client = <span class="g">standby</span>\n<span class="p">$ sudo dscacheutil -flushcache</span>\n<span class="g">PASS: change visible at once after the flush</span>`,
    cmd: "./bin/phase2 ttl", refs: [[T.p2, "p2_demo_ttl() {"], [T.dns, "local-ttl"]] },
  { k: "D", t: "Backend failover", tag: ["Recorded run", ""], p: "Backend A stopped. Every request still returned HTTP 200 from B. When A came back, sharing resumed.",
    term: `healthy          : A B A B A B A B\nBackend A stopped: <span class="g">B B B B B B B B B B</span>\n                   GET /api/status -> HTTP 200  x3\nBackend A back   : A B A B A B A B\n<span class="g">PASS: failover and recovery observed</span>`,
    cmd: "./bin/phase2 failover", refs: [[T.p2, "p2_demo_failover() {"], [T.nginx, "max_fails="], [T.nginx, "proxy_next_upstream "]] },
  { k: "E", t: "Standby edge", tag: ["Recorded run", ""], p: "DNS moved to the standby edge. The client switched only when its cached answer expired.",
    term: `t+0s   dig=standby  client=primary  answered-by <span class="r">primary</span>\nt+19s  dig=standby  client=primary  answered-by <span class="r">primary</span>\nt+38s  dig=standby  client=primary  answered-by <span class="r">primary</span>\nt+41s  dig=standby  client=standby  answered-by <span class="g">STANDBY</span>\n<span class="g">PASS: traffic moved to the standby edge</span>`,
    cmd: "./bin/phase2 cutover", refs: [[T.p2, "p2_demo_cutover() {"], [T.nginx, 'add_header X-Edge "@@EDGE_LABEL@@" always;']] },
  { k: "C", t: "Isolation", tag: ["Live demo", "demo"], p: "Only the edge may reach ports 3001 and 3002. We run this live. Rules the script generates:",
    term: `<span class="d"># pf rules on a backend Mac (port 3002)</span>\npass in quick on lo0 all\n<span class="g">pass  in quick inet proto tcp from { EDGE, STANDBY } to any port 3002</span>\n<span class="r">block drop in quick inet proto tcp from any to any port 3002</span>`,
    cmd: "./bin/phase2 isolate on", refs: [[T.p2, "p2_iso_render() {"], [T.p2, "p2_iso_on() {"], [T.p2, "p2_iso_off() {"], [T.p2, "p2_iso_test() {"]] },
];

const ladder = [
  ["1", "Name", "Does the name become an IP?", "dig @<DNS_IP> app.team1.test", "Timeout or wrong IP means DNS: dnsmasq stopped, wrong record, or wrong resolver.", [["bin/doctor", 'layer "DNS"'], ["scripts/checks.sh", "chk_dns_server()"]]],
  ["2", "Door", "Can we knock on the port?", "nc -vz <EDGE_IP> 8443", "Refused or timeout means nginx is down, the port is wrong, or a firewall rule blocks it.", [["bin/doctor", 'layer "TCP EDGE"'], ["scripts/checks.sh", "chk_edge_tcp()"]]],
  ["3", "ID", "Is the certificate trusted?", "openssl s_client -connect <EDGE_IP>:8443 -servername app.team1.test -CAfile pki/ca.crt", "A verify error means the CA is not installed, the name does not match, or the certificate expired.", [["bin/doctor", 'layer "TLS"'], ["scripts/checks.sh", "chk_tls()"]]],
  ["4", "Answer", "Does the site reply?", "curl -i https://app.team1.test:8443/api/status", "502 means the edge is up but both backends failed. One backend down still works.", [["bin/doctor", 'layer "HTTP / APPLICATION"'], ["scripts/checks.sh", "chk_app()"]]],
];

const index = [
  ["./macs/mac1-mitul/setup.sh", "Mac 1", "Phase 1 setup: DNS + client", "macs/mac1-mitul/setup.sh", ""],
  ["./macs/mac2-hardik/setup.sh", "Mac 2", "Phase 1 setup: edge (creates the CA)", "macs/mac2-hardik/setup.sh", ""],
  ["./macs/mac3-vaibhav/setup.sh", "Mac 3", "Phase 1 setup: Backend A", "macs/mac3-vaibhav/setup.sh", ""],
  ["./macs/mac4-akshat/setup.sh", "Mac 4", "Phase 1 setup: Backend B", "macs/mac4-akshat/setup.sh", ""],
  ["./bin/status", "any", "System view using real requests", "bin/status", ""],
  ["./bin/test-all", "any", "All Phase 1 tests", "bin/test-all", ""],
  ["./bin/doctor", "any", "First failing layer and likely cause", "bin/doctor", 'layer "DNS"'],
  ["./bin/collect-evidence", "any", "Save evidence files", "bin/collect-evidence", ""],
  ["scripts/capture-packets.sh 60", "any", "60 s capture for Wireshark", "scripts/capture-packets.sh", ""],
  ["./bin/phase2 setup", "every Mac", "Arm what this Mac is responsible for", T.p2, "p2_setup() {"],
  ["./bin/phase2 test", "any", "PASS / FAIL for Extensions A to E", "tests/test_phase2.sh", ""],
  ["./bin/phase2 dns-failover", "Mac 1", "Extension A demo", T.p2, "p2_demo_dns_failover() {"],
  ["./bin/phase2 ttl", "Mac 1", "Extension B demo", T.p2, "p2_demo_ttl() {"],
  ["./bin/phase2 isolate on|off|test", "backend Macs", "Extension C firewall", T.p2, "p2_iso_on() {"],
  ["./bin/phase2 failover [a|b]", "any", "Extension D demo", T.p2, "p2_demo_failover() {"],
  ["./bin/phase2 cutover", "Mac 1", "Extension E demo", T.p2, "p2_demo_cutover() {"],
  ["./bin/phase2 drill", "any", "Hidden fault to practise on", T.p2, "p2_drill() {"],
  ["./bin/phase2 rollback", "every Mac", "Undo all Phase 2 changes", T.p2, "p2_rollback() {"],
];

/* ---------------------------------------------------------------- html */
const css = fs.readFileSync(path.join(HERE, "style.css"), "utf8");
const sim = fs.readFileSync(path.join(HERE, "sim.js"), "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Team AEIN · CN Project</title>
<meta name="description" content="A small HTTPS site built from scratch with our own DNS, nginx load balancer and two backends, then broken on purpose. Try the simulator.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23f2a33a'/%3E%3C/svg%3E">
<style>
${css}
</style>
</head>
<body>
<nav aria-label="Sections"><div class="wrap">
  <b>Team AEIN</b>
  <a href="#journey">The journey</a><a href="#tasks">Phase 1</a><a href="#break">Break it</a><a href="#proof">Phase 2 proof</a><a href="#find">Find the fault</a><a href="#commands">Commands</a>
  <a class="gh" href="${GH}" target="_blank" rel="noopener">GitHub ↗</a>
</div></nav>

<header class="hero"><div class="wrap">
  <div class="eyebrow">Computer Networks · Phase 1 + Phase 2</div>
  <h1>A tiny website, built from scratch. Then we broke it on purpose.</h1>
  <p>Our own DNS, our own HTTPS, a load balancer and two backends on real Macs. Follow one request, then press the buttons and try to take it down.</p>
  <div class="cta"><a class="btn primary" href="#break">Break it yourself</a><a class="btn ghost" href="#journey">Follow one request</a></div>
</div></header>

<main class="wrap">

<section id="team">
  <div class="sec-h"><div class="kicker">The team's machines</div><h2>Four Macs, four jobs</h2></div>
  <p class="lead">Each Mac runs one role. With fewer Macs, one Mac takes several roles. Setup is one command per Mac.</p>
  <div class="team">${team.map(([m, n, r, f]) => `<div class="mac"><small>${m}</small><b>${n}</b><span>${r}</span>${refs([[f, ""]])}</div>`).join("")}</div>
</section>

<section id="journey">
  <div class="sec-h"><div class="kicker">Phase 1</div><h2>One request, five stops</h2></div>
  <p class="lead">Type <code>https://app.team1.test:8443</code> and this happens. Tap a stop to see the idea, the command and the code.</p>
  <div class="steps" role="tablist" aria-label="Stops of a request">
    ${stations.map((s) => `<button type="button" class="step" role="tab" aria-selected="false"><small>${s.k}</small><b>${s.h}</b></button>`).join("")}
  </div>
  <div class="panel">
    ${stations.map((s) => `<div class="spanel" role="tabpanel" hidden>
      <div class="sbody">
        <div><p class="analogy">${s.analogy}</p><p class="what">${s.what}</p></div>
        <div><p class="mini">Try it</p>${cmd(s.cmd)}<p class="mini">You will see</p><pre class="see">${esc(s.see)}</pre><p class="mini">Where in the code</p>${refs(s.refs)}</div>
      </div></div>`).join("")}
  </div>
</section>

<section id="tasks">
  <div class="sec-h"><div class="kicker">Phase 1 checklist</div><h2>Seven things we built</h2></div>
  <p class="lead">Tasks A to G from the brief, each with the code behind it.</p>
  <div class="tasks">${tasks.map(([k, t, d, r]) => `<article class="task"><header><span class="badge">${k}</span><h3>${t}</h3></header><p>${d}</p>${refs(r)}</article>`).join("")}</div>
</section>

<section id="break">
  <div class="sec-h"><div class="kicker">Phase 2 · try it</div><h2>Break it yourself</h2></div>
  <p class="lead">This is a model of our real system. Stop something, then send a request and watch what survives.</p>
  <div class="sim">
    <div class="controls">
      <button type="button" class="send" id="b-send">Send a request</button>
      <button type="button" class="ghostb" id="b-six">Send 6 requests</button>
      <h3>Stop something</h3>
      <button type="button" class="tog" id="t-dns" aria-pressed="false"><i>A</i>Stop the primary DNS</button>
      <button type="button" class="tog" id="t-a" aria-pressed="false"><i>D</i>Stop Backend A</button>
      <button type="button" class="tog" id="t-b" aria-pressed="false"><i>D</i>Stop Backend B</button>
      <button type="button" class="tog" id="t-e1" aria-pressed="false"><i>E</i>Stop the primary edge</button>
      <h3>Then fix or protect</h3>
      <button type="button" class="ghostb" id="b-cut">Move DNS to the standby edge</button>
      <button type="button" class="tog" id="t-fw" aria-pressed="false"><i>C</i>Firewall the backends</button>
      <button type="button" class="ghostb" id="b-direct">Client tries a backend directly</button>
      <button type="button" class="ghostb" id="b-reset">Reset</button>
    </div>
    <div class="stage">
      <div class="mapwrap"><svg id="sim" role="img" aria-label="Interactive map of the system: client, DNS, backup DNS, edge, standby edge, and two backends"></svg></div>
      <div class="result" aria-live="polite">
        <div>
          <div class="verdict" id="verdict"><small>Result</small><b id="vbig">-</b><div id="vsub" style="color:var(--muted);font-size:15px"></div></div>
          <div class="chips" id="chips"></div>
        </div>
        <div>
          <ol class="story" id="story"></ol>
          <div id="ttl" hidden><p class="hint" id="ttltxt"></p><div class="ttl"><i id="ttlbar"></i></div></div>
          <p class="hint realcmd" id="real"></p>
        </div>
      </div>
      <p class="hint">Try this: stop Backend A and send 6 requests. Then stop the primary edge, and fix it with the cutover button.</p>
    </div>
  </div>
</section>

<section id="proof">
  <div class="sec-h"><div class="kicker">Phase 2 · proof</div><h2>What happened on the real Macs</h2></div>
  <p class="lead">Each demo saves a transcript and puts the system back afterwards. These are from our recorded runs.</p>
  <div class="rgrid">${receipts.map((r) => `<article class="rec">
    <header><span class="badge amber">${r.k}</span><h3>${r.t}</h3><span class="tag ${r.tag[1]}">${r.tag[0]}</span></header>
    <p>${r.p}</p><pre class="term">${r.term}</pre>${cmd(r.cmd)}${refs(r.refs)}</article>`).join("")}</div>
  <p class="note"><b>The one thing left that can still break:</b> the edge nginx. Our fix today is a standby edge plus a DNS cutover. It is manual and takes about one TTL. A real fix is two edges sharing a floating IP (VRRP), or DNS health checks that move the record by themselves.</p>
</section>

<section id="find">
  <div class="sec-h"><div class="kicker">Extension F</div><h2>Something broke? Ask in this order</h2></div>
  <p class="lead">Follow the path of the request. The first stop that fails is the problem.</p>
  ${ladder.map(([n, h, q, c, f, r]) => `<details${n === "1" ? " open" : ""}><summary><span class="n">${n}</span>${h}<em>${q}</em></summary><div class="dbody">${cmd(c)}<p class="fail">${f}</p>${refs(r)}</div></details>`).join("")}
  <p class="hint"><code>./bin/doctor</code> runs this whole chain and names the first failing stop. <code>./bin/phase2 drill</code> hides a fault for us to practise on.</p>
</section>

<section id="commands">
  <div class="sec-h"><div class="kicker">Cheat sheet</div><h2>Every command and where it lives</h2></div>
  <input class="search" type="search" id="q" placeholder="Filter: dns, edge, failover, firewall" aria-label="Filter commands">
  <div class="tblwrap"><table class="tbl" id="tbl">
    <thead><tr><th>Command</th><th class="hide-s">Run on</th><th>Does</th><th>Code</th></tr></thead>
    <tbody>${index.map(([c, on, d, f, n]) => `<tr><td>${cmd(c)}</td><td class="hide-s">${on}</td><td>${d}</td><td>${ref(f, n)}</td></tr>`).join("")}</tbody>
  </table></div>
</section>

</main>
<footer><div class="wrap">Built by Team AEIN for the Computer Networks project. Source and docs: <a href="${GH}" target="_blank" rel="noopener">github.com/mitul-bhatia/cn_project</a>. The simulator is a model; the recorded runs above are from the real system.</div></footer>

<script>
${sim}
</script>
</body>
</html>
`;
fs.writeFileSync(OUT, html);
console.log("wrote", OUT, html.length, "bytes");
