#!/usr/bin/env python3
"""Fill inventory.yaml fields from NetBox (optional, read-only).

Usage: python3 netbox_inventory.py [--base inventory.yaml] [--out out/inventory-netbox.yaml]
       python3 build.py --inventory out/inventory-netbox.yaml

The base file is a normal inventory. Entries that name a NetBox object with a `netbox:` key
get the fields NetBox knows; everything else (colors, notes, services, pools, the media
pipeline) stays as written. A field is filled only when it is missing from the entry or set
to the string `netbox`, so a value written in the base file always wins. The output has the
`netbox:` keys removed and renders with build.py like any inventory.

    vlans[]                    netbox: <VID>          → name, subnet (prefix linked to the VLAN), tag
    fritzbox/opnsense/switch/
    terra/devices.<key>        netbox: <device name>  → model (device type), ip (primary IPv4), os (platform)
    switch                     ports missing / netbox → ports from the interfaces (cable peer, speed, 802.1Q)
    opnsense/terra             hw missing / an item `netbox` → tiles from modules (CPU, Memory, GPU, Hard disk)
    terra guests               netbox: <VM name>      → id (custom field `vmid`, else serial), ip, note

Only GET requests are sent. Token: NETBOX_TOKEN, or the file NETBOX_TOKEN_FILE (default
~/.netbox_token); v1 tokens are sent as `Token …`, v2 tokens (nbt_…) as `Bearer …`.
URL: NETBOX_URL, e.g. https://netbox.example.com. No dependencies besides PyYAML.
"""
import json
import os
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter

import yaml

ROOT = pathlib.Path(__file__).resolve().parent
NB = "netbox"           # key that links an entry to NetBox, and the value that asks NetBox for a field


def arg(name, default):
    if name not in sys.argv:
        return default
    i = sys.argv.index(name) + 1
    if i >= len(sys.argv) or sys.argv[i].startswith("--"):
        raise SystemExit(f"{name} needs a file")
    return pathlib.Path(sys.argv[i])


BASE = arg("--base", ROOT / "inventory.yaml")
OUT = arg("--out", ROOT / "out" / "inventory-netbox.yaml")
URL = os.environ.get("NETBOX_URL", "").rstrip("/")
if not URL:
    raise SystemExit("set NETBOX_URL, e.g. NETBOX_URL=https://netbox.example.com")
if os.environ.get("NETBOX_TOKEN"):
    TOKEN = os.environ["NETBOX_TOKEN"]
else:
    tf = pathlib.Path(os.environ.get("NETBOX_TOKEN_FILE", "~/.netbox_token")).expanduser()
    if not tf.is_file():
        raise SystemExit(f"set NETBOX_TOKEN or put the token into {tf}")
    TOKEN = tf.read_text()
TOKEN = TOKEN.strip().removeprefix("Bearer ").removeprefix("Token ").strip()
AUTH = f"Bearer {TOKEN}" if TOKEN.startswith("nbt_") else f"Token {TOKEN}"

FILLED, KEPT, MISSING = [], [], []      # the report at the end


def get(path, **params):
    """All results of a NetBox list endpoint (follows pagination)."""
    query = urllib.parse.urlencode({"limit": 1000, **params}, doseq=True)
    url, out = f"{URL}/api/{path}/?{query}", []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": AUTH, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            page = json.load(r)
        out += page["results"]
        url = page.get("next")
    return out


def one(path, **params):
    found = get(path, **params)
    return found[0] if len(found) == 1 else None


def bare(address):
    return address.split("/")[0] if address else None


def fill(entry, field, value, where):
    """Set entry[field] from NetBox unless the base file has a real value for it."""
    if value in (None, "", []):
        if entry.get(field) == NB:
            MISSING.append(f"{where}.{field}: asked for, but NetBox has no value")
            entry.pop(field)
        return
    if field in entry and entry[field] != NB:
        if entry[field] != value:
            KEPT.append(f"{where}.{field}: kept {entry[field]!r} (NetBox: {value!r})")
        return
    entry[field] = value
    FILLED.append(f"{where}.{field}")


# ---------------------------------------------------------------- formatting
def speed(kbps):
    """NetBox interface speed (kbit/s) → the labels build.py uses (SPEED_W)."""
    if not kbps:
        return None
    return {100_000: "100M", 1_000_000: "1G", 2_500_000: "2.5G", 5_000_000: "5G", 10_000_000: "10G",
            25_000_000: "25G", 40_000_000: "40G", 100_000_000: "100G"}.get(kbps, f"{kbps // 1000}M")


def gb(n_mb):
    """NetBox VM memory / disk size (MB) → '16 GB'."""
    return f"{n_mb} MB" if n_mb < 1024 else f"{n_mb / 1024:.3g} GB"


def disk_size(n_gb):
    """Disk size as sold: 16000 → '16 TB', 500 → '500 GB'."""
    return f"{n_gb / 1000:.3g} TB" if n_gb >= 1000 else f"{n_gb} GB"


def model_name(manufacturer, model):
    """'Samsung' + '980 500GB' → 'Samsung 980 500GB'; no doubled manufacturer."""
    return model if model.lower().startswith(manufacturer.lower()) else f"{manufacturer} {model}"


# ---------------------------------------------------------------- devices
def device_card(card, where):
    name = card.pop(NB, None)
    if name is None:
        return None
    dev = one("dcim/devices", name=name)
    if not dev:
        MISSING.append(f"{where}: NetBox device {name!r} not found, entry left as written")
        return None
    dt = dev["device_type"]
    fill(card, "model", model_name(dt["manufacturer"]["name"], dt["model"]), where)
    fill(card, "ip", bare((dev.get("primary_ip4") or {}).get("address")), where)
    fill(card, "os", (dev.get("platform") or {}).get("name"), where)
    return dev


def hw_tiles(dev):
    """Hardware tiles from the device's modules, by module type profile (NetBox 4.3+)."""
    mods = sorted(get("dcim/modules", device_id=dev["id"]), key=lambda m: m["module_bay"]["name"])
    types = {t["id"]: t for t in get("dcim/module-types", id=sorted({m["module_type"]["id"] for m in mods}))} if mods else {}
    by_profile = {}
    for m in mods:
        t = types.get(m["module_type"]["id"], {})
        by_profile.setdefault((t.get("profile") or {}).get("name"), []).append((m, t, t.get("attributes") or {}))

    tiles = []
    for m, t, a in by_profile.get("CPU", []):
        sub = " · ".join(x for x in [f"{a['cores']} cores" if a.get("cores") else None,
                                     f"{a['speed']} GHz" if a.get("speed") else None] if x)
        tiles.append({"icon": "glyph-cpu", "label": "CPU", "value": model_name(t["manufacturer"]["name"], t["model"]),
                      "sub": m.get("description") or sub})
    if by_profile.get("Memory"):
        ram = by_profile["Memory"]
        sizes = Counter(a.get("size") for _, _, a in ram)
        cls = ram[0][2].get("class", "")
        sub = " + ".join(f"{n}× {s} GB" for s, n in sizes.items() if s) or f"{len(ram)} modules"
        tiles.append({"icon": "glyph-ram", "label": "MEMORY",
                      "value": f"{sum(a.get('size') or 0 for _, _, a in ram)} GB {cls}".strip(),
                      "sub": ram[0][0].get("description") or sub})
    for m, t, a in by_profile.get("GPU", []):
        tiles.append({"icon": "glyph-gpu", "label": "GPU", "value": a.get("gpu") or t["model"],
                      "sub": m.get("description") or (f"{a['memory']} GB" if a.get("memory") else "")})
    disks = Counter()                       # identical disks → one tile '7× Seagate Exos 16 TB'
    for m, t, a in by_profile.get("Hard disk", []):
        kind = (a.get("type") or "").upper()
        value = model_name(t["manufacturer"]["name"], t["model"])
        if a.get("size") and not re.search(r"\d\s?[GT]B\b", value, re.I):
            value += f" {disk_size(a['size'])}"
        sub = m.get("description") or {"NVME": "NVMe", "SSD": "SATA SSD", "HD": "HDD"}.get(kind, kind)
        disks[("glyph-hdd" if kind == "HD" else "glyph-ssd", "HDD" if kind == "HD" else "SSD", value, sub)] += 1
    for (icon, label, value, sub), n in disks.items():
        tiles.append({"icon": icon, "label": label, "value": f"{n}× {value}" if n > 1 else value, "sub": sub})
    return tiles


def fill_hw(card, dev, where):
    hw = card.get("hw")
    if hw is not None and NB not in hw:
        return
    tiles = hw_tiles(dev)
    if not tiles:
        MISSING.append(f"{where}.hw: no CPU / Memory / GPU / Hard disk modules in NetBox")
    card["hw"] = tiles if hw is None else [x for item in hw for x in (tiles if item == NB else [item])]
    FILLED.append(f"{where}.hw ({len(tiles)} tiles)")


# ---------------------------------------------------------------- switch ports
def switch_ports(dev, where):
    """Front-panel ports: RJ45 → etherN, SFP/SFP+ → sfppN (the names build.py expects).
    The number comes from a label 'Port N' / 'SFP+ N' if there is one, else from the order in NetBox."""
    ports, n_rj, n_sfp, skipped = [], 0, 0, set()
    for i in get("dcim/interfaces", device_id=dev["id"]):
        itype = i["type"]["value"]
        if i.get("mgmt_only") or itype in ("virtual", "bridge", "lag") or itype.startswith("ieee802.11"):
            continue
        sfp = "sfp" in itype or "-x-" in itype
        m = re.fullmatch(r"(?:Port|SFP\+?)\s*(\d+)", i.get("label") or "")
        if sfp:
            n_sfp = int(m.group(1)) if m else n_sfp + 1
            p = {"name": f"sfpp{n_sfp}"}
        else:
            n_rj = int(m.group(1)) if m else n_rj + 1
            p = {"name": f"ether{n_rj}"}
        peers = i.get("connected_endpoints") or i.get("link_peers") or []
        peer = (peers[0].get("device") or {}).get("name") if peers else None
        if not i.get("enabled") or not i.get("cable") or not peer:
            p["to"] = "free"
        else:
            p["to"] = CARD_NAME.get(peer, peer)
            if speed(i.get("speed")):
                p["speed"] = speed(i["speed"])      # informational: build.py draws link widths by hand
            mode = (i.get("mode") or {}).get("value")
            unt = (i.get("untagged_vlan") or {}).get("vid")
            if mode == "tagged-all":
                tagged = [v for v in VID_KEY if v != unt]
            elif mode == "tagged":
                tagged = [v["vid"] for v in i.get("tagged_vlans") or []]
            else:
                tagged = []
            for vid in [unt, *tagged]:
                if vid and vid not in VID_KEY:
                    skipped.add(vid)
            if VID_KEY.get(unt):
                p["untagged"] = VID_KEY.get(unt)
            keys = [VID_KEY.get(v) for v in tagged if VID_KEY.get(v) and v != unt]
            if keys:
                p["tagged"] = sorted(keys, key=KEY_ORDER.index)
        ports.append(p)
    ports.sort(key=lambda p: (p["name"].startswith("sfpp"), int(re.sub(r"\D", "", p["name"]))))
    if skipped:
        MISSING.append(f"{where}.ports: VLAN {', '.join(map(str, sorted(skipped)))} not in the vlans table, left off the ports")
    return ports


# ---------------------------------------------------------------- guests
def guest(g, where, full_ip):
    name = g.pop(NB, None)
    if name is None:
        return None
    vm = one("virtualization/virtual-machines", name=name)
    if not vm:
        MISSING.append(f"{where}: NetBox VM {name!r} not found, entry left as written")
        return None
    vid = (vm.get("custom_fields") or {}).get("vmid")
    if vid is None and str(vm.get("serial") or "").isdigit():
        vid = int(vm["serial"])
    if vid is None:
        MISSING.append(f"{where}.id: VM {name!r} has no custom field vmid and no numeric serial")
    fill(g, "id", vid, where)
    ip = bare((vm.get("primary_ip4") or {}).get("address"))
    fill(g, "ip", ip if full_ip or not ip else "." + ip.rsplit(".", 1)[1], where)
    if full_ip:              # other-VLAN guest cards show '<kind> <id> · vCPU · memory'
        parts = [f"{g.get('kind', 'VM')} {g['id']}" if "id" in g else None,
                 f"{vm['vcpus']:g} vCPU" if vm.get("vcpus") else None,
                 gb(vm["memory"]) if vm.get("memory") else None]
        fill(g, "note", " · ".join(x for x in parts if x), where)
    else:
        fill(g, "note", vm.get("description"), where)
    return vm


# ---------------------------------------------------------------- merge
INV = yaml.safe_load(BASE.read_text(encoding="utf-8"))

# VLAN table: `netbox: <VID>` on a row; rows without it keep working if their key is the VID
VID_KEY, KEY_ORDER = {}, [v["key"] for v in INV["vlans"]]
for v in INV["vlans"]:
    vid = v.pop(NB, None)
    if vid is None:
        if str(v["key"]).isdigit():
            VID_KEY[int(v["key"])] = v["key"]
        continue
    VID_KEY[int(vid)] = v["key"]
    where = f"vlans[{v['key']}]"
    nv = get("ipam/vlans", vid=vid)
    if len(nv) != 1:
        MISSING.append(f"{where}: {len(nv)} VLANs with VID {vid} in NetBox, row left as written")
        continue
    prefixes = get("ipam/prefixes", vlan_id=nv[0]["id"], family=4)
    fill(v, "name", nv[0]["name"], where)
    fill(v, "subnet", prefixes[0]["prefix"] if prefixes else None, where)
    fill(v, "tag", f"VLAN {vid}", where)
    if not prefixes:
        MISSING.append(f"{where}.subnet: no IPv4 prefix linked to VLAN {vid}")

# cable peers are shown with the card name when the peer is a card on the diagram
CARDS = {s: INV[s] for s in ("fritzbox", "opnsense", "switch", "terra") if isinstance(INV.get(s), dict)}
CARDS.update({f"devices.{k}": d for k, d in (INV.get("devices") or {}).items()})
CARD_NAME = {c[NB]: c["name"] for c in CARDS.values() if c.get(NB) and c.get("name")}

DEVS = {where: device_card(card, where) for where, card in CARDS.items()}
for where in ("opnsense", "terra"):
    if DEVS.get(where):
        fill_hw(CARDS[where], DEVS[where], where)
if DEVS.get("switch") and CARDS["switch"].get("ports", NB) == NB:
    CARDS["switch"]["ports"] = switch_ports(DEVS["switch"], "switch")
    used = sum(p["to"] != "free" for p in CARDS["switch"]["ports"])
    FILLED.append(f"switch.ports ({len(CARDS['switch']['ports'])} ports, {used} cabled)")

seen_vms = set()
terra = INV.get("terra") or {}
for grp in terra.get("dmz_groups") or []:
    for g in grp.get("guests", []):
        vm = guest(g, f"terra.dmz_groups[{grp['name']}].{g.get('name', '?')}", full_ip=False)
        if vm:
            seen_vms.add(vm["id"])
for key, g in (terra.get("other_guests") or {}).items():
    vm = guest(g, f"terra.other_guests.{key}", full_ip=True)
    if vm:
        seen_vms.add(vm["id"])
if DEVS.get("terra"):
    rest = [vm["name"] for vm in get("virtualization/virtual-machines", device_id=DEVS["terra"]["id"])
            if vm["id"] not in seen_vms]
    if rest:
        MISSING.append(f"terra: {len(rest)} NetBox VMs on this host have no card: {', '.join(sorted(rest))}")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(f"# Generated by netbox_inventory.py from {BASE.name} + NetBox; edit {BASE.name} or NetBox instead.\n"
               + yaml.safe_dump(INV, sort_keys=False, allow_unicode=True, width=140), encoding="utf-8")
print(f"wrote {OUT}")
print(f"\nfrom NetBox ({len(FILLED)}):" + "".join(f"\n  {x}" for x in FILLED))
if KEPT:
    print(f"\nwritten in {BASE.name}, differs from NetBox ({len(KEPT)}):" + "".join(f"\n  {x}" for x in KEPT))
if MISSING:
    print(f"\nmissing / not found ({len(MISSING)}):" + "".join(f"\n  ! {x}" for x in MISSING))
