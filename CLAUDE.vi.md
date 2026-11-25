# CLAUDE.md – tuỳ biến sơ đồ này cho homelab của người khác

Bạn đang giúp một người dùng biến homelab **của họ** thành một sơ đồ như `docs/example.png`. Repo hiện mô tả lab của tác giả gốc. Việc của bạn: tìm hiểu lab của họ trông như thế nào, viết lại `inventory.yaml`, tuỳ biến bố cục trong `build.py`, và lặp lại việc render cùng họ cho đến khi họ hài lòng.

Hãy bắt đầu bằng cách nói ngắn gọn cho người dùng cách việc này vận hành (phỏng vấn → inventory → bố cục → các vòng render/góp ý), rồi bắt đầu buổi phỏng vấn. Đừng hỏi mọi thứ cùng một lúc.

## Repo hoạt động như thế nào

- `inventory.yaml` – toàn bộ nội dung: VLAN, thiết bị, cổng switch, port forward, phần cứng server, VM/container, pool lưu trữ, media pipeline.
- `build.py` – bố cục đặt thủ công. Vẽ một SVG với toạ độ tuyệt đối (canvas logic `W = 2400`, chiều cao `H`), nhúng icon dưới dạng base64, chuyển thành PNG bằng `rsvg-convert -z 1.6` (nên pixel PNG = đơn vị SVG × 1.6).
- `fetch_icons.py` – tải các icon dịch vụ vào `icons/` (dashboard-icons). Các glyph riêng `icons/glyph-*.svg` nằm trong repo.
- Đầu ra: `out/homelab.png` (đã ẩn thông tin nhạy cảm, an toàn để đăng) và `out/homelab-unredacted.png` (`--unredacted`).

### Phần nào là tổng quát, phần nào bị hardcode

Tổng quát (điều khiển bởi YAML): bảng VLAN, chú giải, thẻ "Open to the internet", các dịch vụ cloud, danh sách phần cứng/dịch vụ của OPNsense, cổng switch (nhãn, vạch VLAN, màu), thẻ thiết bị, SSID, ô phần cứng của server, thẻ guest, các nhóm DMZ và chip của chúng, thẻ container nhiều app, pool lưu trữ, các nút và share của media pipeline.

Bị hardcode trong `build.py` (gần như chắc chắn bạn sẽ sửa những phần này):

| Mục (tìm theo) | Cái gì bị cố định | Thay đổi thường gặp |
|---|---|---|
| `# TOP: edge chain` | các vị trí `CX`, `cy0`, `fy, fh` (router ISP), `ox, oy, ow, oh` (tường lửa), `bx, by, bw, bh` (switch) | chiều cao/chiều rộng khác, không có router ISP (chế độ bridge), không có tường lửa riêng |
| Khối router ISP (`FBX`, `COAX_X`, `FB_PORTS`) | một modem cáp với một cổng coax + các cổng LAN, tường lửa ở `opnsense_port` | DSL/fiber/ONT: đổi tên cổng coax hoặc bỏ nó đi, thay danh sách cổng |
| `port_x()`, `PX0, PITCH` | switch với 8 RJ45 + 2 SFP+ trên một hàng | số cổng khác, switch thứ hai |
| `# device row`: `DY`, các tuple `MAD/KVM/AP/ZB` và các lời gọi `device("madcat", …)` | thiết bị nào nằm dưới switch, x/chiều rộng/chiều cao của chúng, và đường cáp tới chúng (`MAD_10G`, `KVM_IN`, `AP_IN`, `ZB_IN`, các lời gọi `S.line(... PORTS["etherN"] ...)`) | thêm/bớt thiết bị, định tuyến lại cáp để chúng không cắt nhau |
| `# terra` | thẻ server lớn: `tx0, ty0`, `GY`, `ZH`, chiều rộng cột phần cứng `HWW`, cột guest `gx, gw` | nhiều server, cách chia cột khác |
| guest ở các VLAN khác | `og["truenas"]`, `og["haos"]`, `og["unifi"]`, `og["bliss"]` vẽ chồng lên nhau với chiều cao cố định | các VM khác ngoài DMZ |
| `# DMZ zone`: `NCOL` và các lời gọi `column(i, [group names])` | nhóm DMZ nào vào cột nào | cân lại các cột cho các nhóm của họ |
| `# media pipeline` | một panel giải thích *arr/Jellyfin | bỏ toàn bộ mục nếu họ không muốn, hoặc tái sử dụng cho một luồng khác |
| `W` | chiều rộng canvas | `H` được tính ở cuối từ panel thấp nhất (`# canvas height`); sửa dòng đó nếu bạn thêm một panel bên dưới terra |

Lưới an toàn: các `assert` ở cuối mỗi mục sẽ báo lỗi rõ ràng khi một cột/panel tràn. Độ rộng chữ đến từ `measure()` (Pillow + font thật) hoặc ước lượng thô `tw()`. Luôn kiểm tra bằng mắt.

## Buổi phỏng vấn

Hỏi theo từng vòng 3–6 câu, nhóm theo chủ đề, và đưa ra các giá trị mặc định. Nếu người dùng có tài liệu (wiki, ghi chú, một repo docs) hoặc bạn có quyền truy cập shell vào hệ thống của họ, hãy đề nghị đọc những thứ đó trước và chỉ hỏi những chỗ còn thiếu. **Chỉ chạy các lệnh chỉ-đọc, và hỏi trước khi động vào bất kỳ hệ thống nào.**

1. **Mục đích & riêng tư:** đăng công khai (ví dụ Reddit) hay riêng tư? Domain thật cần ẩn? Tên SSID thật cần ẩn? Watermark tên người dùng? Tiêu đề và ngày?
2. **Đường biên internet:** loại kết nối ISP và tốc độ (xuống/lên), model modem/router, các cổng của nó và cổng nào tường lửa dùng, chế độ bridge hay double NAT/exposed host, nhà cung cấp DNS, đích backup offsite.
3. **Tường lửa/router:** phần cứng (CPU, RAM, NIC), hệ điều hành + phiên bản, IP/hostname quản lý, các dịch vụ (DNS, DHCP, VPN, IDS/IPS, …), LACP/bond.
4. **(Các) switch:** model, hệ điều hành/phiên bản, IP quản lý, và theo từng cổng: thiết bị kết nối, tốc độ đã đàm phán, VLAN untagged, các VLAN tagged. (Nhiều switch in được thông tin này, ví dụ RouterOS `/interface ethernet monitor [find] once` và `/interface bridge vlan print`.)
5. **VLAN:** ID, tên, subnet, chính sách một dòng ("internet only", "services, no LAN access", …). Màu: giữ mặc định trừ khi họ muốn khác.
6. **Thiết bị khác:** (các) máy trạm, KVM, access point (SSID → VLAN), radio/coordinator IoT, các hộp NAS, bất cứ thứ gì có dây cáp.
7. **(Các) server:** hypervisor + phiên bản, CPU, RAM, GPU, NIC, mọi đĩa (model/dung lượng) và đĩa có được passthrough cho một VM hay không.
8. **Guest:** mọi VM/container: ID, IP, VLAN, cái gì chạy trong đó. Các container chạy nhiều app (thường là Docker) trở thành một thẻ với một hàng cho mỗi app. App nào là công khai (sau reverse proxy, hiển thị dạng `app.domain`), app nào chỉ trong LAN, app nào không có web UI (`name.internal`)?
9. **Lưu trữ:** pool/vdev/đĩa, đã dùng/còn trống, các share và ai mount chúng.
10. **Port forward:** cổng, giao thức, đích, mục đích.
11. **Phần thêm:** truy cập từ xa/VPN, dịch vụ cloud, một luồng đáng giải thích (như media pipeline), bất cứ thứ gì họ tự hào hoặc muốn làm nổi bật.

Các lệnh chỉ-đọc hữu ích nếu bạn có quyền truy cập (hỏi trước): Proxmox `pct list`, `qm list`, `pct config <id>`; `docker ps`; `ip -br a`; ZFS `zpool list -v`, `zfs list`; TrueNAS `midclt call pool.query`, `midclt call disk.query`; `lspci`; `lsblk -o NAME,MODEL,SIZE`.

## Vòng lặp làm việc

1. Viết `inventory.yaml` cho lab của họ (giữ schema; mở rộng khi cần và dạy `build.py` các trường mới).
2. Tuỳ biến `build.py`: quyết định panel nào tồn tại, điều chỉnh các vị trí hardcode ở trên, bỏ các mục họ không cần.
3. `python3 fetch_icons.py` (thêm icon mới vào `ICON_MAP` trước: tên cục bộ → tên trong [dashboard-icons](https://github.com/homarr-labs/dashboard-icons); icon tối màu cần một biến thể `-light` hoặc một mục trong `RECOLOR`).
4. `python3 build.py`, rồi **tự nhìn vào `out/homelab.png`** trước khi cho người dùng xem. Phóng to các vùng đông đúc: `magick out/homelab.png -crop 1400x600+X+Y +repage -resize 70% /tmp/crop.png` (X/Y tính theo pixel PNG = toạ độ SVG × 1.6). Tìm chữ chồng chéo, cáp cắt qua thẻ, chữ chạy ra khỏi hộp, khoảng trống thừa.
5. Cho người dùng xem, nhận góp ý, thay đổi, render lại. Hãy chờ đợi nhiều vòng nhỏ, đó là bình thường.
6. Trước khi họ chia sẻ: render không có `--unredacted` và `grep` `out/homelab.svg` để tìm domain thật, tên SSID và bất cứ thứ gì riêng tư của họ.

## Quy tắc thiết kế (giữ nguyên trừ khi người dùng muốn khác)

- **Độ dày nét = tốc độ liên kết đã đàm phán** (`SPEED_W`), cộng một thẻ tốc độ nhỏ ở nơi cáp chạm tới thiết bị. Trunk (VLAN tagged) là cáp trắng lõi đậm; liên kết access dùng màu của VLAN.
- Chỉ **cáp vật lý mới là nét liền**. Chấm chấm = logic, qua internet (VPN, dịch vụ cloud). Nét đứt xám = console KVM.
- **Viền thẻ = màu VLAN của thiết bị**; thiết bị trên trunk (tường lửa, switch, hypervisor, AP với nhiều SSID) dùng `TRUNK_BORDER` trung tính.
- **Thiết bị vật lý** dùng thẻ tab thư mục: tab = `name · type`; thân = icon, tên model đầy đủ (hoặc nó là gì, với máy tự lắp), `IP · hostname` theo màu VLAN, hệ điều hành + phiên bản.
- **Ô phần cứng** có thanh màu nâu nhạt ở bên trái; nhãn = loại (CPU, MEMORY, SSD, …), giá trị = linh kiện, dòng phụ = thông tin thêm hoặc `passthrough → <guest>`.
- **Chip DMZ:** `CT <id>` ở góc trên phải, `.<octet cuối>` bên dưới nó; dòng thứ ba = hostname: `app.domain` màu xanh nếu công khai qua reverse proxy, ngược lại là `name.internal`, cộng một pill `LAN` khi hostname công khai chỉ truy cập được từ LAN/VPN.
- **Container nhiều app** là một thẻ cao hơn với một hàng cho mỗi app. Huy hiệu Docker chỉ xuất hiện trên container Docker nhiều app.
- **Không có cổng chỉ dùng nội bộ** (cổng API v.v.); chỉ những gì được forward từ internet mới xuất hiện, trong thẻ "Open to the internet".
- Dung lượng ZFS tính theo TiB/GiB (những gì ZFS báo), dung lượng đĩa theo TB như khi bán.
- Giữ chữ đơn giản và ngắn; không có phụ đề kiểu marketing.

### Các trường inventory tuỳ chọn

Tất cả đều tuỳ chọn; bỏ qua chúng thì render y như trước.

| Trường | Ở đâu | Tác dụng |
|---|---|---|
| `stub: true` | `fritzbox` | Hộp ISP bạn không quản lý (ONT, modem ISP): một hộp nhỏ với `name · type` và `model`, WAN đi thẳng xuống tường lửa, không có hàng cổng |
| `short` | `switch.ports[]` | nhãn dưới cổng thay cho `to` (cho tên thiết bị dài) |
| một cổng không có cả `untagged` lẫn `tagged` (và `to` không phải `free`/`rescue`) | `switch.ports[]` | vẽ màu xám: đang dùng, không rõ VLAN |
| Số cổng RJ45 | `switch.ports[]` | `port_x()` đếm các cổng không phải `sfpp`, nên các cổng SFP+ nối tiếp sau cổng RJ45 cuối cùng; hơn ~9 cổng RJ45 cần một thẻ rộng hơn (`bw`), một assert sẽ cho bạn biết |
| `kind: VM` | guest DMZ | chip hiển thị `VM <id>` thay cho `CT <id>` |
| `node` | guest DMZ | thành viên cluster mà guest chạy trên đó, sau id (`VM 101 · pve2`) |
| `vlan` | guest DMZ | khi nó khác VLAN của DMZ, một thanh theo màu VLAN đó ở cạnh trái của chip |
| `vlans: [..]` | `ssids[]` | PPSK (một SSID, mật khẩu quyết định VLAN): `PPSK` + một chấm cho mỗi VLAN thay cho thẻ VLAN; `vlan` khi đó là tuỳ chọn (nó chỉ tô màu chấm bên trái tên) |
| `warn` | pools | thanh dung lượng chuyển cam ở mức phần trăm này trở lên (mặc định 85) |

Các nhóm đĩa của pool không vừa cạnh nhau sẽ xuống hàng thứ hai; assert sẽ cho bạn biết hộp pool phải cao bao nhiêu.

## Bẫy thường gặp

- Font: **Fira Sans** và **Fira Code** phải được cài, nếu không rsvg dùng font dự phòng và mọi phép tính độ rộng đều sai.
- jsDelivr đôi khi từ chối từng icon riêng lẻ với lỗi 403; `fetch_icons.py` dự phòng bằng GitHub thô.
- Khi nội dung phình ra, hãy tăng chiều cao các mục (`ZH`, hộp pool, …); các assert sẽ cho bạn biết ở đâu. Chiều cao canvas tự theo sau.
- `python3 build.py --inventory other.yaml` render một file inventory khác, tiện để thử thay đổi mà không động vào `inventory.yaml`.
- Một thiết bị có cáp đi vào từ phía trên phải có điểm vào nằm bên phải tab thư mục của nó (xem cách `KVM_IN`/`AP_IN` dùng `tab_width()`).
