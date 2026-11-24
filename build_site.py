#!/usr/bin/env python3
"""Build the interactive web page from inventory.yaml.

Usage: python3 build_site.py [--unredacted] [--inventory FILE]
                                     → out/site/   (--unredacted → out/site-unredacted/)
The hand-written page lives in site/ (index.html, style.css, app.js). This script copies it,
writes data.js from the inventory, copies the icons it uses and embeds the SVG from build.py
for the Diagram tab (run build.py first, with the same --unredacted flag).
Open index.html directly or upload the folder to any static host.

Like build.py, the mapping from the inventory to the page is written for one specific lab:
see the sections "devices", "topology" and "host sections" below.
"""
import ipaddress
import json
import pathlib
import shutil
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent
if "--inventory" in sys.argv:
    _i = sys.argv.index("--inventory") + 1
    if _i >= len(sys.argv) or sys.argv[_i].startswith("--"):
        raise SystemExit("--inventory needs a file")
    INV_FILE = pathlib.Path(sys.argv[_i])
else:
    INV_FILE = ROOT / "inventory.yaml"
INV = yaml.safe_load(INV_FILE.read_text())
UNREDACTED = "--unredacted" in sys.argv
NAME = "homelab-unredacted" if UNREDACTED else "homelab"
SRC, ICONS = ROOT / "site", ROOT / "icons"
SVG = ROOT / "out" / f"{NAME}.svg"
OUT = ROOT / "out" / ("site-unredacted" if UNREDACTED else "site")

META, RED = INV["meta"], INV["redact"]
DOMAIN = META["domain"]
SHOWN = DOMAIN if (UNREDACTED or not RED["domain"]) else RED["domain_placeholder"]
INTERNAL = META.get("internal_suffix", "internal")
NETS = {v["key"]: v for v in INV["vlans"]}
USED_ICONS = {"docker"}                    # Docker badge


# ---------------------------------------------------------------- helpers (same rules as build.py)
def sub(s):
    """Fill {domain} placeholders and apply redaction."""
    s = str(s).replace("{domain}", SHOWN)
    return s if (UNREDACTED or not RED["domain"]) else s.replace(DOMAIN, SHOWN)


def icon(name):
    if name:
        USED_ICONS.add(name)
    return name


def fqdn(h):
    """'@' = the domain itself, a name with a dot is taken as is, else <h>.<domain>."""
    if h == "@":
        return SHOWN
    return sub(h) if "." in h else f"{h}.{SHOWN}"


PROXIES = [{**p, "domain": sub(p["domain"]), "where": sub(p["where"])} for p in INV.get("proxies", [])]


def address(g):
    """Hostname, URL, reverse proxy and exposure for anything with host / internal / url fields."""
    out = {"hostname": None, "url": None, "proxy": None, "exposure": None}
    if g.get("host"):
        name = fqdn(g["host"])
        out.update(hostname=name, url=f"https://{name}",
                   exposure="local" if g.get("exposure") == "local" else "public",
                   proxy=next((p["name"] for p in PROXIES
                               if name == p["domain"] or name.endswith("." + p["domain"])), None))
    elif g.get("internal"):
        n = g["internal"]
        out["hostname"] = n if "." in n else f"{n}.{INTERNAL}"
    if g.get("url"):
        out["url"] = g["url"]
    return out


def full_ip(ip, net):
    """'.54' → '10.0.20.54' using the network's subnet; full addresses pass through."""
    if not ip or not ip.startswith(".") or net not in NETS:
        return ip
    return str(ipaddress.ip_network(NETS[net]["subnet"]).network_address).rsplit(".", 1)[0] + ip


SERVICES = []


def add_service(name, icon_, host, where, kind, g=None, ip=None, note=None):
    """One entry in the searchable service list; returns its id."""
    sid = f"s{len(SERVICES)}"
    SERVICES.append({"id": sid, "name": name, "icon": icon(icon_), "host": host, "where": where,
                     "kind": kind, "ip": ip, "note": sub(note) if note else None, **address(g or {})})
    return sid


def device(key, d, icon_, net=None, **extra):
    """A physical box: topology node + side panel (+ a section when it hosts guests)."""
    out = {"id": key, "name": d["name"], "type": d["type"], "model": d.get("model"), "os": d.get("os"),
           "ip": d.get("ip"), "icon": icon(icon_), "net": net, "note": d.get("config"), **address(d), **extra}
    if d.get("hw"):
        out["hw"] = [{**h, "icon": icon(h["icon"])} for h in d["hw"]]
    if d.get("services"):
        out["services"] = [{"name": s["name"], "note": sub(s["note"]), "icon": icon(s["icon"]),
                            "sid": add_service(s["name"], s["icon"], key, d["name"], "service", note=s["note"])}
                           for s in d["services"]]
    return out


def guest(g, host, zone):
    """A VM/CT: its apps become services; a single-app guest is a service itself."""
    kind = g.get("kind", "CT")
    label = f"{kind} {g['id']}"
    net = g.get("vlan", zone)
    ip = full_ip(g.get("ip", f".{g['id']}"), net)
    where = f"{label} · {g['name']}"
    out = {"label": label, "name": g["name"], "icon": icon((g.get("icons") or [None])[0]),
           "icons": [icon(i) for i in g.get("icons", [])], "badge": icon(g.get("badge")), "ip": ip,
           "net": net, "note": sub(g.get("note", "")), "docker": bool(g.get("docker")), "apps": [], **address(g)}
    for a in g.get("apps", []):
        sid = add_service(a["name"], a["icon"], host, where, "app" if a.get("host") else "service", a, ip, a.get("note"))
        out["apps"].append(sid)
    if not g.get("apps"):
        out["sid"] = add_service(g["name"], out["icon"], host, where, "app" if g.get("host") else "service",
                                 g, ip, g.get("note"))
    if g.get("addons_text"):                       # add-ons without a web UI (Home Assistant)
        names = g["addons_text"].split(" · ")
        icons_ = g.get("addons", []) if len(g.get("addons", [])) == len(names) else [None] * len(names)
        out["addons"] = [add_service(n, i, host, where, "add-on", ip=ip, note=f"add-on in {g['name']}")
                         for n, i in zip(names, icons_)]
    return out


# ================================================================ devices (lab-specific)
FB, OPN, SW, T = INV["fritzbox"], INV["opnsense"], INV["switch"], INV["terra"]
DEVICES = {}
DEVICES["fritzbox"] = device("fritzbox", FB, "fritzbox", "wan",
                             ports=[] if FB.get("stub") else
                             [{"name": f"LAN {i + 1}", "speed": sp, "to": "OPNsense (exposed host)"
                               if i == FB["opnsense_port"] else None} for i, sp in enumerate(FB["lan_ports"])])
DEVICES["opnsense"] = device("opnsense", OPN, "opnsense", None)
DEVICES["switch"] = device(
    "switch", SW, "mikrotik-l", None,
    ports=[{"name": p["name"], "to": None if p["to"] in ("free", "rescue") else p["to"],
            "vlans": " · ".join(filter(None, [p.get("untagged") and f"untagged {p['untagged']}",
                                              p.get("tagged") and "tagged " + ", ".join(p["tagged"])]))}
           for p in SW["ports"]])
SSIDS = [{"name": s["redacted"] if (RED["ssid_names"] and not UNREDACTED) else s["name"],
          "nets": s.get("vlans") or [s["vlan"]]} for s in INV.get("ssids", [])]
for key, d in INV["devices"].items():
    DEVICES[key] = device(key, d, d["icons"][0], None if d.get("trunk") else d["vlan"],
                          ssids=SSIDS if key == "ap" else None)
DEVICES["terra"] = device("terra", T, "proxmox", None)

# ================================================================ topology (lab-specific)
# grid areas, one list per row ("." = empty); node ids must match the area names.
# Lines run straight down, elbow down-across-down, or sideways: keep a free path between linked boxes.
TOPOLOGY = {
    "rows": [
        ["remote", "internet", "internet", "cloud"],
        [".",      "fritzbox", "fritzbox", "cloud"],
        [".",      "opnsense", "opnsense", "."],
        ["terra",  "switch",   "switch",   "."],
        ["madcat", "jetkvm",   "ap",       "slzb"],
    ],
    # style: solid | dotted | trunk; net colors the line; speed sets its width (like build.py)
    "edges": [
        {"from": "remote", "to": "internet", "style": "dotted", "net": "vpn"},
        {"from": "internet", "to": "cloud", "style": "dotted"},
        {"from": "internet", "to": "fritzbox", "style": "solid"},
        {"from": "fritzbox", "to": "opnsense", "style": "solid", "net": "wan", "speed": "1G"},
        {"from": "opnsense", "to": "switch", "style": "trunk", "speed": "2.5G", "label": "LACP · 2× 2.5G"},
        {"from": "switch", "to": "madcat", "style": "solid", "net": "10", "speed": "10G", "label": "10G + 2.5G"},
        {"from": "switch", "to": "jetkvm", "style": "solid", "net": "10", "speed": "100M"},
        {"from": "switch", "to": "ap", "style": "trunk", "speed": "2.5G"},
        {"from": "switch", "to": "slzb", "style": "solid", "net": "40", "speed": "100M"},
        {"from": "switch", "to": "terra", "style": "trunk", "speed": "10G"},
    ],
}

# ================================================================ host sections (lab-specific)
OG = T["other_guests"]
groups = [{"label": grp["name"], "net": "20", "guests": [guest(g, "terra", "20") for g in grp["guests"]]}
          for grp in T["dmz_groups"]]
groups.append({"label": "Outside the DMZ", "guests": [guest(g, "terra", g["vlan"]) for g in OG.values()]})
storage = [{"label": f"{g['name']} · {g.get('kind', 'CT')} {g['id']}", "pools": g["pools"], "note": g.get("footer")}
           for g in OG.values() if g.get("pools")]
HOSTS = [{"device": "terra", "groups": groups, "storage": storage}]

# ================================================================ data.js
data = {
    "meta": {"title": META["title"] if (UNREDACTED or not RED["domain"]) else META["title_redacted"],
             "date": META["date"], "domain": SHOWN, "access_note": META.get("access_note")},
    "networks": INV["vlans"],
    "internet": {"note": INV["internet"].get("note"), "speed": INV["internet"].get("speed"),
                 "cloud": [{**c, "icon": icon(c["icon"]), "note": sub(c["note"])}
                           for c in INV["internet"]["cloud_services"]]},
    "remote": {"name": INV["remote"]["name"], "note": INV["remote"]["note"], "icon": icon("wireguard"), "net": "vpn"},
    "port_forwards": [{**p, "what": sub(p["what"])} for p in INV["port_forwards"]],
    "proxies": PROXIES,
    "devices": DEVICES,
    "topology": TOPOLOGY,
    "hosts": HOSTS,
    "services": SERVICES,
    "backups": [{**b, "from_icon": icon(b["from_icon"]), "to_icon": icon(b["to_icon"])} for b in INV.get("backups", [])],
    "diagram": SVG.read_text() if SVG.exists() else None,
}

missing = sorted(n for n in USED_ICONS if not (ICONS / f"{n}.svg").exists())
if missing:
    raise SystemExit(f"missing icons {missing} – run: python3 fetch_icons.py")
if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "icons").mkdir(parents=True)
for f in ("index.html", "style.css", "app.js"):
    shutil.copy(SRC / f, OUT / f)
for n in USED_ICONS:
    shutil.copy(ICONS / f"{n}.svg", OUT / "icons" / f"{n}.svg")
(OUT / "data.js").write_text("window.LAB = " + json.dumps(data, ensure_ascii=False) + ";\n")
if not data["diagram"]:
    print(f"note: {SVG.relative_to(ROOT)} not found, the Diagram tab stays empty (run build.py first)")
print(OUT / "index.html")
