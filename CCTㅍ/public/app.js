const { useEffect, useMemo, useRef, useState } = React;

const PURPOSES = ["전체", "방범", "교통", "시설관리", "재난안전"];

function formatDateTime(value) {
  if (!value) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "요청 처리에 실패했습니다.");
  return data;
}

function App() {
  const [cctvs, setCctvs] = useState([]);
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [logs, setLogs] = useState([]);
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("전체");
  const [view, setView] = useState("map");
  const [notice, setNotice] = useState("");

  const filteredCctvs = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return cctvs.filter(cctv => {
      const matchesPurpose = purpose === "전체" || cctv.purpose === purpose;
      const matchesQuery =
        !keyword ||
        cctv.name.toLowerCase().includes(keyword) ||
        cctv.location.toLowerCase().includes(keyword) ||
        cctv.agency.toLowerCase().includes(keyword);
      return matchesPurpose && matchesQuery;
    });
  }, [cctvs, query, purpose]);

  async function loadAll() {
    const [nextCctvs, nextReports] = await Promise.all([api("/api/cctvs"), api("/api/reports")]);
    setCctvs(nextCctvs);
    setReports(nextReports);
    if (!selected && nextCctvs.length) setSelected(nextCctvs[0]);
    if (selected) setSelected(nextCctvs.find(cctv => cctv.id === selected.id) || nextCctvs[0]);
  }

  async function selectCctv(cctv) {
    setSelected(cctv);
    setView("map");
    const nextLogs = await api(`/api/cctvs/${encodeURIComponent(cctv.id)}/logs`);
    setLogs(nextLogs);
  }

  useEffect(() => {
    loadAll().catch(error => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (selected) selectCctv(selected).catch(error => setNotice(error.message));
  }, [selected?.id]);

  return (
    React.createElement("div", { className: "app-shell" },
      React.createElement(Header, { view, setView }),
      React.createElement("main", { className: "workspace" },
        React.createElement("section", { className: "map-section" },
          React.createElement(SearchBar, { query, setQuery, purpose, setPurpose }),
          React.createElement(CctvMap, { cctvs: filteredCctvs, selected, onSelect: selectCctv }),
          React.createElement(CctvStrip, { cctvs: filteredCctvs, selected, onSelect: selectCctv })
        ),
        React.createElement("aside", { className: "side-panel" },
          view === "map" && React.createElement(DetailPanel, { selected, logs, setView }),
          view === "logs" && React.createElement(LogPanel, { selected, logs }),
          view === "report" && React.createElement(ReportPanel, { selected, setNotice, loadAll }),
          view === "admin" && React.createElement(AdminPanel, { cctvs, reports, setNotice, loadAll })
        )
      ),
      notice && React.createElement("div", { className: "toast", onClick: () => setNotice("") }, notice)
    )
  );
}

function Header({ view, setView }) {
  const tabs = [
    ["map", "지도"],
    ["logs", "열람기록"],
    ["report", "시민 제보"],
    ["admin", "관리자 샘플"]
  ];

  return (
    React.createElement("header", { className: "topbar" },
      React.createElement("div", null,
        React.createElement("p", { className: "eyebrow" }, "시민 공개형 CCTV 투명성 서비스"),
        React.createElement("h1", null, "CCTV 열람기록 추적 시스템")
      ),
      React.createElement("nav", { className: "tabs", "aria-label": "화면 선택" },
        tabs.map(([key, label]) =>
          React.createElement("button", {
            key,
            className: view === key ? "active" : "",
            onClick: () => setView(key)
          }, label)
        )
      )
    )
  );
}

function SearchBar({ query, setQuery, purpose, setPurpose }) {
  return (
    React.createElement("div", { className: "searchbar" },
      React.createElement("input", {
        value: query,
        onChange: event => setQuery(event.target.value),
        placeholder: "지역명, CCTV 이름, 기관명 검색",
        "aria-label": "검색"
      }),
      React.createElement("div", { className: "chips" },
        PURPOSES.map(item =>
          React.createElement("button", {
            key: item,
            className: purpose === item ? "chip active" : "chip",
            onClick: () => setPurpose(item)
          }, item)
        )
      )
    )
  );
}

function CctvMap({ cctvs, selected, onSelect }) {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { zoomControl: false }).setView([37.5666, 126.9784], 15);
    L.control.zoom({ position: "bottomright" }).addTo(mapRef.current);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(mapRef.current);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        mapRef.current.setView([position.coords.latitude, position.coords.longitude], 15);
      });
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    if (layerRef.current) layerRef.current.remove();
    layerRef.current = L.layerGroup().addTo(mapRef.current);

    cctvs.forEach(cctv => {
      const hasWarning = cctv.warnings.length > 0;
      const marker = L.circleMarker([cctv.lat, cctv.lng], {
        radius: selected?.id === cctv.id ? 12 : 9,
        color: hasWarning ? "#b42318" : "#14532d",
        fillColor: hasWarning ? "#f97316" : "#22c55e",
        fillOpacity: 0.9,
        weight: 3
      });
      marker.bindPopup(`<strong>${cctv.name}</strong><br>${cctv.location}<br>${cctv.purpose} · ${cctv.agency}`);
      marker.on("click", () => onSelect(cctv));
      marker.addTo(layerRef.current);
    });
  }, [cctvs, selected?.id]);

  return React.createElement("div", { className: "map-card", ref: containerRef });
}

function CctvStrip({ cctvs, selected, onSelect }) {
  return (
    React.createElement("div", { className: "cctv-strip" },
      cctvs.map(cctv =>
        React.createElement("button", {
          key: cctv.id,
          className: selected?.id === cctv.id ? "cctv-pill active" : "cctv-pill",
          onClick: () => onSelect(cctv)
        },
          React.createElement("strong", null, cctv.name),
          React.createElement("span", null, `${cctv.purpose} · ${cctv.status}`)
        )
      )
    )
  );
}

function DetailPanel({ selected, logs, setView }) {
  if (!selected) return React.createElement("div", { className: "empty" }, "CCTV를 선택해 주세요.");
  return (
    React.createElement("div", { className: "panel-content" },
      React.createElement("div", { className: "panel-heading" },
        React.createElement("span", { className: "badge" }, selected.purpose),
        React.createElement("h2", null, selected.name),
        React.createElement("p", null, selected.location)
      ),
      selected.warnings.length > 0 && React.createElement("div", { className: "warning-box" },
        selected.warnings.map(warning => React.createElement("strong", { key: warning }, warning))
      ),
      React.createElement("dl", { className: "info-grid" },
        React.createElement("dt", null, "CCTV ID"), React.createElement("dd", null, selected.id),
        React.createElement("dt", null, "설치 목적"), React.createElement("dd", null, selected.purpose),
        React.createElement("dt", null, "관리 기관"), React.createElement("dd", null, selected.agency),
        React.createElement("dt", null, "운영 상태"), React.createElement("dd", null, selected.status),
        React.createElement("dt", null, "최근 열람 횟수"), React.createElement("dd", null, `${selected.recentAccessCount}회`),
        React.createElement("dt", null, "최근 열람 일시"), React.createElement("dd", null, formatDateTime(selected.lastAccessAt)),
        React.createElement("dt", null, "열람 사유 요약"), React.createElement("dd", null, selected.accessReasonSummary)
      ),
      React.createElement("div", { className: "action-row" },
        React.createElement("button", { className: "primary", onClick: () => setView("logs") }, "열람기록 보기"),
        React.createElement("button", { className: "secondary", onClick: () => setView("report") }, "제보하기")
      ),
      React.createElement("h3", null, "최근 공개 열람기록"),
      React.createElement(LogList, { logs: logs.slice(0, 4) })
    )
  );
}

function LogPanel({ selected, logs }) {
  return (
    React.createElement("div", { className: "panel-content" },
      React.createElement("div", { className: "panel-heading" },
        React.createElement("span", { className: "badge muted" }, "개인정보 비공개"),
        React.createElement("h2", null, selected ? `${selected.name} 열람기록` : "열람기록"),
        React.createElement("p", null, "기관명, 열람 날짜, 열람 목적만 시민에게 공개됩니다.")
      ),
      React.createElement(LogList, { logs })
    )
  );
}

function LogList({ logs }) {
  if (!logs.length) return React.createElement("div", { className: "empty" }, "공개할 열람기록이 없습니다.");
  return (
    React.createElement("ul", { className: "log-list" },
      logs.map(log =>
        React.createElement("li", { key: log.id },
          React.createElement("time", null, formatDateTime(log.date)),
          React.createElement("strong", null, log.purpose),
          React.createElement("span", null, log.agency)
        )
      )
    )
  );
}

function ReportPanel({ selected, setNotice, loadAll }) {
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");

  async function submitReport(event) {
    event.preventDefault();
    const report = {
      cctvId: selected?.id || "",
      cctvName: selected?.name || "선택 안 됨",
      content,
      contact
    };
    await api("/api/reports", { method: "POST", body: JSON.stringify(report) });
    setContent("");
    setContact("");
    setNotice("제보가 접수되었습니다. 관리자가 검토할 수 있습니다.");
    loadAll();
  }

  return (
    React.createElement("form", { className: "panel-content form-stack", onSubmit: submitReport },
      React.createElement("div", { className: "panel-heading" },
        React.createElement("span", { className: "badge" }, "시민 제보"),
        React.createElement("h2", null, selected ? selected.name : "CCTV 선택 필요"),
        React.createElement("p", null, "의심스러운 열람이나 사생활 침해 우려를 남길 수 있습니다.")
      ),
      React.createElement("label", null, "제보 내용",
        React.createElement("textarea", {
          value: content,
          onChange: event => setContent(event.target.value),
          placeholder: "예: 새벽 시간대 열람이 반복되어 확인을 요청합니다.",
          required: true
        })
      ),
      React.createElement("label", null, "연락처 선택 입력",
        React.createElement("input", {
          value: contact,
          onChange: event => setContact(event.target.value),
          placeholder: "답변을 받고 싶을 때만 입력"
        })
      ),
      React.createElement("button", { className: "primary", type: "submit" }, "제보 제출")
    )
  );
}

function AdminPanel({ cctvs, reports, setNotice, loadAll }) {
  const [cctvForm, setCctvForm] = useState({
    name: "",
    location: "",
    purpose: "방범",
    agency: "",
    status: "운영중",
    lat: "37.5666",
    lng: "126.9784"
  });
  const [logForm, setLogForm] = useState({
    cctvId: cctvs[0]?.id || "",
    date: "2026-05-16T13:00",
    purpose: "",
    agency: ""
  });

  useEffect(() => {
    if (!logForm.cctvId && cctvs[0]) setLogForm(form => ({ ...form, cctvId: cctvs[0].id }));
  }, [cctvs]);

  function updateCctvForm(key, value) {
    setCctvForm(form => ({ ...form, [key]: value }));
  }

  function updateLogForm(key, value) {
    setLogForm(form => ({ ...form, [key]: value }));
  }

  async function submitCctv(event) {
    event.preventDefault();
    await api("/api/admin/cctvs", { method: "POST", body: JSON.stringify(cctvForm) });
    setNotice("CCTV가 등록되었습니다.");
    setCctvForm({ ...cctvForm, name: "", location: "", agency: "" });
    loadAll();
  }

  async function submitLog(event) {
    event.preventDefault();
    await api("/api/admin/access-logs", { method: "POST", body: JSON.stringify(logForm) });
    setNotice("열람기록이 등록되었습니다.");
    setLogForm({ ...logForm, purpose: "", agency: "" });
    loadAll();
  }

  return (
    React.createElement("div", { className: "panel-content admin-grid" },
      React.createElement("div", { className: "panel-heading" },
        React.createElement("span", { className: "badge muted" }, "샘플 관리자"),
        React.createElement("h2", null, "데이터 입력 화면"),
        React.createElement("p", null, "시연용 등록 기능입니다.")
      ),
      React.createElement("form", { className: "mini-form", onSubmit: submitCctv },
        React.createElement("h3", null, "CCTV 등록"),
        React.createElement("input", { value: cctvForm.name, onChange: e => updateCctvForm("name", e.target.value), placeholder: "CCTV 이름", required: true }),
        React.createElement("input", { value: cctvForm.location, onChange: e => updateCctvForm("location", e.target.value), placeholder: "설치 위치", required: true }),
        React.createElement("select", { value: cctvForm.purpose, onChange: e => updateCctvForm("purpose", e.target.value) }, PURPOSES.slice(1).map(item => React.createElement("option", { key: item }, item))),
        React.createElement("input", { value: cctvForm.agency, onChange: e => updateCctvForm("agency", e.target.value), placeholder: "관리 기관", required: true }),
        React.createElement("div", { className: "two-cols" },
          React.createElement("input", { value: cctvForm.lat, onChange: e => updateCctvForm("lat", e.target.value), placeholder: "위도", required: true }),
          React.createElement("input", { value: cctvForm.lng, onChange: e => updateCctvForm("lng", e.target.value), placeholder: "경도", required: true })
        ),
        React.createElement("button", { className: "primary" }, "등록")
      ),
      React.createElement("form", { className: "mini-form", onSubmit: submitLog },
        React.createElement("h3", null, "열람기록 등록"),
        React.createElement("select", { value: logForm.cctvId, onChange: e => updateLogForm("cctvId", e.target.value) }, cctvs.map(cctv => React.createElement("option", { key: cctv.id, value: cctv.id }, cctv.name))),
        React.createElement("input", { type: "datetime-local", value: logForm.date, onChange: e => updateLogForm("date", e.target.value), required: true }),
        React.createElement("input", { value: logForm.purpose, onChange: e => updateLogForm("purpose", e.target.value), placeholder: "열람 목적", required: true }),
        React.createElement("input", { value: logForm.agency, onChange: e => updateLogForm("agency", e.target.value), placeholder: "기관명", required: true }),
        React.createElement("button", { className: "primary" }, "등록")
      ),
      React.createElement("section", { className: "report-list" },
        React.createElement("h3", null, "제보 목록"),
        reports.map(report =>
          React.createElement("article", { key: report.id, className: "report-item" },
            React.createElement("strong", null, report.cctvName),
            React.createElement("p", null, report.content),
            React.createElement("span", null, `${formatDateTime(report.createdAt)} · ${report.status}`)
          )
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
