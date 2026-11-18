# CLAUDE.md – adapting this diagram to someone else's homelab

You are helping a user turn **their** homelab into a diagram like `docs/example.png`. The repo currently describes the original author's lab. Your job: find out what their lab looks like, rewrite `inventory.yaml`, adapt the layout in `build.py`, and iterate on the render with them until they are happy.

Start by telling the user briefly how this works (interview → inventory → layout → render/feedback rounds), then begin the interview. Don't ask everything at once.

## How the repo works

- `inventory.yaml` – all content: VLANs, devices, switch ports, port forwards, server hardware, VMs/containers, storage pools, the media pipeline.
- `build.py` – hand-placed layout. Draws an SVG with absolute coordinates (logical canvas `W = 2400`, height `H`), embeds icons as base64, converts to PNG with `rsvg-convert -z 1.6` (so PNG pixels = SVG units × 1.6).
- `fetch_icons.py` – downloads service icons into `icons/` (dashboard-icons). Own glyphs `icons/glyph-*.svg` are in the repo.
- `netbox_inventory.py` – optional: fills inventory fields from NetBox (read-only) and writes a new inventory file, see [Optional: NetBox as a data source](#optional-netbox-as-a-data-source).
- Output: `out/homelab.png` (redacted, safe to post) and `out/homelab-unredacted.png` (`--unredacted`).

### What is generic and what is hardcoded

Generic (driven by the YAML): VLAN table, legend, "Open to the internet" card, cloud services, OPNsense hardware/services lists, switch ports (labels, VLAN ticks, colors), device cards, SSIDs, server hardware tiles, guest cards, DMZ groups and their chips, multi-app container cards, storage pools, the media pipeline nodes and shares.

Hardcoded in `build.py` (you will almost certainly edit these):

| Section (search for) | What's fixed | Typical change |
|---|---|---|
| `# TOP: edge chain` | positions `CX`, `cy0`, `fy, fh` (ISP router), `ox, oy, ow, oh` (firewall), `bx, by, bw, bh` (switch) | different heights/widths, no ISP router (bridge mode), no separate firewall |
| ISP router block (`FBX`, `COAX_X`, `FB_PORTS`) | a cable modem with a coax port + LAN ports, firewall in `opnsense_port` | DSL/fiber/ONT: rename the coax port or remove it, change port list |
| `port_x()`, `PX0, PITCH` | switch with 8 RJ45 + 2 SFP+ in one row | other port counts, second switch |
| `# device row`: `DY`, `MAD/KVM/AP/ZB` tuples and the `device("madcat", …)` calls | which devices sit under the switch, their x/width/height, and the cable routing to them (`MAD_10G`, `KVM_IN`, `AP_IN`, `ZB_IN`, the `S.line(... PORTS["etherN"] ...)` calls) | add/remove devices, re-route cables so they don't cross |
| `# terra` | the big server card: `tx0, ty0`, `GY`, `ZH`, hardware column width `HWW`, guest column `gx, gw` | several servers, other column split |
| other-VLAN guests | `og["truenas"]`, `og["haos"]`, `og["unifi"]`, `og["bliss"]` drawn one below another with fixed heights | different VMs outside the DMZ |
| `# DMZ zone`: `NCOL` and the `column(i, [group names])` calls | which DMZ group goes into which column | rebalance columns for their groups |
| `# media pipeline` | an *arr/Jellyfin explainer panel | remove the whole section if they don't want it, or reuse it for another flow |
| `W` | canvas width | `H` is computed at the end from the lowest panel (`# canvas height`); adjust that line if you add a panel below terra |

Safety nets: `assert`s at the end of sections fail loudly when a column/panel overflows. Text widths come from `measure()` (Pillow + the real font) or the rough estimate `tw()`. Always check visually.

## The interview

Ask in rounds of 3–6 questions, grouped by topic, and offer defaults. If the user has documentation (wiki, notes, a docs repo) or you have shell access to their systems, offer to read that first and only ask for the gaps. **Only run read-only commands, and ask before touching any system.**

1. **Purpose & privacy:** public post (e.g. Reddit) or private? Real domain to hide? Real SSID names to hide? Username watermark? Title and date?
2. **Internet edge:** ISP connection type and speed (down/up), modem/router model, its ports and which one the firewall uses, bridge mode or double NAT/exposed host, DNS provider, offsite backup target.
3. **Firewall/router:** hardware (CPU, RAM, NICs), OS + version, management IP/hostname, services (DNS, DHCP, VPN, IDS/IPS, …), LACP/bonds.
4. **Switch(es):** model, OS/version, management IP, and per port: connected device, negotiated speed, untagged VLAN, tagged VLANs. (Many switches can print this, e.g. RouterOS `/interface ethernet monitor [find] once` and `/interface bridge vlan print`.)
5. **VLANs:** ID, name, subnet, one-line policy ("internet only", "services, no LAN access", …). Colors: keep the defaults unless they want others.
6. **Other devices:** workstation(s), KVM, access points (SSIDs → VLANs), IoT radios/coordinators, NAS boxes, anything with a cable.
7. **Server(s):** hypervisor + version, CPU, RAM, GPU, NICs, every disk (model/size) and whether it's passed through to a VM.
8. **Guests:** every VM/container: ID, IP, VLAN, what runs in it. Containers running several apps (often Docker) become one card with a row per app. Which apps are public (behind a reverse proxy, shown as `app.domain`), which LAN-only, which have no web UI (`name.internal`)?
9. **Storage:** pools/vdevs/disks, used/free, shares and who mounts them.
10. **Port forwards:** port, protocol, target, purpose.
11. **Extras:** remote access/VPN, cloud services, a flow worth explaining (like the media pipeline), anything they're proud of or want to highlight.

Useful read-only commands if you have access (ask first): Proxmox `pct list`, `qm list`, `pct config <id>`; `docker ps`; `ip -br a`; ZFS `zpool list -v`, `zfs list`; TrueNAS `midclt call pool.query`, `midclt call disk.query`; `lspci`; `lsblk -o NAME,MODEL,SIZE`.

## The work loop

1. Write `inventory.yaml` for their lab (keep the schema; extend it when needed and teach `build.py` the new fields).
2. Adapt `build.py`: decide which panels exist, adjust the hardcoded positions above, remove sections they don't need.
3. `python3 fetch_icons.py` (add new icons to `ICON_MAP` first: local name → name in [dashboard-icons](https://github.com/homarr-labs/dashboard-icons); dark icons need a `-light` variant or an entry in `RECOLOR`).
4. `python3 build.py`, then **look at `out/homelab.png` yourself** before showing it. Zoom into busy areas: `magick out/homelab.png -crop 1400x600+X+Y +repage -resize 70% /tmp/crop.png` (X/Y in PNG pixels = SVG coordinates × 1.6). Look for overlapping text, cables crossing cards, text running out of boxes, empty gaps.
5. Show the user, take feedback, change, re-render. Expect many small rounds, that's normal.
6. Before they share it: render without `--unredacted` and `grep` `out/homelab.svg` for their real domain, SSID names and anything private.

## Design rules (keep them unless the user wants otherwise)

- **Line width = negotiated link speed** (`SPEED_W`), plus a small speed tag where a cable reaches a device. Trunks (tagged VLANs) are a white cable with a dark core; access links use the VLAN color.
- Only **physical cables are solid lines**. Dotted = logical, over the internet (VPN, cloud services). Dashed grey = KVM console.
- **Card border = the device's VLAN color**; devices on a trunk (firewall, switch, hypervisor, APs with several SSIDs) get the neutral `TRUNK_BORDER`.
- **Physical devices** use the folder-tab card: tab = `name · type`; body = icon, full model name (or what it is, for self-built machines), `IP · hostname` in the VLAN color, OS + version.
- **Hardware tiles** have the tan bar on the left; label = type (CPU, MEMORY, SSD, …), value = the part, sub line = extra info or `passthrough → <guest>`.
- **DMZ chips:** `CT <id>` top-right, `.<last octet>` below it; third line = hostname: blue `app.domain` if public via the reverse proxy, `name.internal` otherwise, plus a `LAN` pill when the public hostname is LAN/VPN-only.
- **Multi-app containers** are one taller card with a row per app. The Docker badge only appears on multi-app Docker containers.
- **No internal-only ports** (API ports etc.); only what's forwarded from the internet appears, in the "Open to the internet" card.
- ZFS sizes in TiB/GiB (what ZFS reports), disk sizes in TB as sold.
- Keep text plain and short; no marketing-style subtitles.

### Optional inventory fields

All optional; leaving them out renders exactly as before.

| Field | Where | Effect |
|---|---|---|
| `stub: true` | `fritzbox` | ISP box you don't manage (ONT, ISP modem): a small box with `name · type` and `model`, WAN drops straight to the firewall, no port row |
| `short` | `switch.ports[]` | label under the port instead of `to` (for long device names) |
| a port with neither `untagged` nor `tagged` (and `to` not `free`/`rescue`) | `switch.ports[]` | drawn grey: in use, VLANs unknown |
| RJ45 port count | `switch.ports[]` | `port_x()` counts the non-`sfpp` ports, so the SFP+ ports follow the last RJ45 port; more than ~9 RJ45 ports need a wider card (`bw`), an assert tells you |
| `kind: VM` | DMZ guests | chip shows `VM <id>` instead of `CT <id>` |
| `node` | DMZ guests | cluster member the guest runs on, after the id (`VM 101 · pve2`) |
| `vlan` | DMZ guests | when it differs from the DMZ VLAN, a bar in that VLAN's color on the chip's left edge |
| `vlans: [..]` | `ssids[]` | PPSK (one SSID, the password picks the VLAN): `PPSK` + one dot per VLAN instead of the VLAN tag; `vlan` is then optional (it only colors the dot left of the name) |
| `warn` | pools | usage bar turns orange at/above this percentage (default 85) |

Pool disk groups that don't fit next to each other wrap to a second row; the assert tells you how tall the pool box must be.

## Optional: NetBox as a data source

If the user documents the lab in NetBox, ask whether the facts should come from there. Then the file they keep is a *base inventory* with `netbox:` links, and `netbox_inventory.py` writes the inventory that `build.py` renders:

```bash
NETBOX_URL=https://netbox.example.com python3 netbox_inventory.py [--base inventory.yaml] [--out out/inventory-netbox.yaml]
python3 build.py --inventory out/inventory-netbox.yaml
```

Token: `NETBOX_TOKEN`, or the file `NETBOX_TOKEN_FILE` (default `~/.netbox_token`); v1 tokens and v2 tokens (`nbt_…`) both work. The script only sends GET requests, so a read-only token is enough. The output goes to `out/` by default, which is git-ignored: it holds the user's real names and IPs.

**Rule:** NetBox fills a field only when it is missing from the entry or set to the string `netbox`. A value written in the base file always wins (the report lists where it differs from NetBox). The `netbox:` keys are removed from the output.

| Base entry | NetBox object | Fields filled |
|---|---|---|
| `vlans[]` with `netbox: <VID>` | VLAN with that VID, IPv4 prefix assigned to it | `name`, `subnet`, `tag` (`VLAN <VID>`). Rows without `netbox:` still map port VLANs when their `key` is the VID |
| `fritzbox`, `opnsense`, `switch`, `terra`, `devices.<key>` with `netbox: <device name>` | device | `model` (manufacturer + device type), `ip` (primary IPv4), `os` (platform) |
| `switch` with `ports` missing or `ports: netbox` | the device's interfaces | `ports`: RJ45 → `etherN`, SFP/SFP+ → `sfppN` (N from a label `Port N` / `SFP+ N`, else NetBox order); `to` = cable peer, shown as the card `name` when the peer is a linked card, `free` without a cable or when disabled; `speed` (`10G`, `2.5G`, …); `untagged` / `tagged` from the 802.1Q mode (`tagged-all` = every VLAN in the table) |
| `opnsense`, `terra` with `hw` missing, or an item `netbox` in `hw` | modules with the module type profiles CPU, Memory, GPU, Hard disk (NetBox 4.3+) | hardware tiles: CPU (cores, speed), MEMORY (total + class, sub `4× 8 GB`), GPU, SSD/HDD (identical disks grouped as `7× …`). A module's description, if set, becomes the sub line (e.g. `passthrough → TrueNAS`). The `netbox` item is replaced by the tiles, other items stay (NETWORK tiles: NetBox has no NIC model) |
| guests in `terra.dmz_groups[].guests` and `terra.other_guests` with `netbox: <VM name>` | virtual machine | `id` (custom field `vmid`, else a numeric `serial`), `ip` (primary IPv4; DMZ chips get `.<last octet>`), `note` (DMZ: the VM description; other guests: `<kind> <id> · N vCPU · M GB`) |

Stays in the base file: colors, VLAN notes, `type`, icons, `internal`/`host`/`exposure`, services, SSIDs, port forwards, pools, apps, the media pipeline. `kind` (VM/CT) is not guessed.

When adapting:
- The per-port `speed` is informational: link widths are drawn in `build.py` (`# links switch → devices`). Use it to pick the `SPEED_W` of each cable.
- `build.py` addresses ports by name (`PORTS["ether3"]`, `PORTS["sfpp2"]`); after importing a switch with other ports, fix those references and the switch width (`bw`, the assert tells you).
- A VLAN used on a port but missing from the `vlans` table is left off the port and reported, since every key needs a color.
- The report lists NetBox VMs on the `terra` device that have no card, so nothing is forgotten.

## Gotchas

- Fonts: **Fira Sans** and **Fira Code** must be installed, otherwise rsvg falls back and every width calculation is off.
- jsDelivr sometimes refuses single icons with 403; `fetch_icons.py` falls back to raw GitHub.
- When content grows, grow the section heights (`ZH`, pool boxes, …); the asserts tell you where. The canvas height follows on its own.
- `python3 build.py --inventory other.yaml` renders a different inventory file, handy for trying changes without touching `inventory.yaml`.
- A device whose cable enters from above must have its entry point right of its folder tab (see how `KVM_IN`/`AP_IN` use `tab_width()`).
