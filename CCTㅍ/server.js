const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "data", "db.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

function readDb() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("요청 본문이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 500);
}

function buildCctvSummary(cctv, logs) {
  const relatedLogs = logs
    .filter(log => log.cctvId === cctv.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const recentLogs = relatedLogs.slice(0, 6);
  const lastLog = recentLogs[0] || null;
  const now = new Date("2026-05-16T12:00:00+09:00");
  const last24h = relatedLogs.filter(log => now - new Date(log.date) <= 24 * 60 * 60 * 1000);
  const nightLogs = relatedLogs.filter(log => {
    const hour = new Date(log.date).getHours();
    return hour >= 22 || hour < 6;
  });

  const warnings = [];
  if (last24h.length >= 4) warnings.push("최근 열람 증가");
  if (nightLogs.length >= 3) warnings.push("비정상 시간대 열람 주의");

  return {
    ...cctv,
    recentAccessCount: recentLogs.length,
    lastAccessAt: lastLog ? lastLog.date : null,
    accessReasonSummary: recentLogs.map(log => log.purpose).join(", ") || "최근 열람 없음",
    warnings
  };
}

async function handleApi(req, res, url) {
  const db = readDb();
  const cctvLogMatch = url.pathname.match(/^\/api\/cctvs\/([^/]+)\/logs$/);

  if (req.method === "GET" && url.pathname === "/api/cctvs") {
    const cctvs = db.cctvs.map(cctv => buildCctvSummary(cctv, db.accessLogs));
    sendJson(res, 200, cctvs);
    return;
  }

  if (req.method === "GET" && cctvLogMatch) {
    const cctvId = decodeURIComponent(cctvLogMatch[1]);
    const logs = db.accessLogs
      .filter(log => log.cctvId === cctvId)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map(({ id, date, purpose, agency }) => ({ id, date, purpose, agency }));
    sendJson(res, 200, logs);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reports") {
    sendJson(res, 200, db.reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reports") {
    const body = await parseBody(req);
    const report = {
      id: createId("report"),
      cctvId: sanitizeText(body.cctvId),
      cctvName: sanitizeText(body.cctvName, "선택 안 됨"),
      content: sanitizeText(body.content),
      contact: sanitizeText(body.contact),
      status: "접수",
      createdAt: new Date().toISOString()
    };
    if (!report.content) {
      sendJson(res, 400, { message: "제보 내용을 입력해 주세요." });
      return;
    }
    db.reports.push(report);
    writeDb(db);
    sendJson(res, 201, report);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/cctvs") {
    const body = await parseBody(req);
    const cctv = {
      id: createId("cctv"),
      name: sanitizeText(body.name, "새 CCTV"),
      location: sanitizeText(body.location),
      purpose: sanitizeText(body.purpose, "방범"),
      agency: sanitizeText(body.agency),
      status: sanitizeText(body.status, "운영중"),
      lat: Number(body.lat),
      lng: Number(body.lng)
    };
    if (!cctv.location || !cctv.agency || Number.isNaN(cctv.lat) || Number.isNaN(cctv.lng)) {
      sendJson(res, 400, { message: "위치, 기관, 좌표를 확인해 주세요." });
      return;
    }
    db.cctvs.push(cctv);
    writeDb(db);
    sendJson(res, 201, buildCctvSummary(cctv, db.accessLogs));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/access-logs") {
    const body = await parseBody(req);
    const log = {
      id: createId("log"),
      cctvId: sanitizeText(body.cctvId),
      date: sanitizeText(body.date, new Date().toISOString()),
      purpose: sanitizeText(body.purpose),
      agency: sanitizeText(body.agency)
    };
    if (!db.cctvs.some(cctv => cctv.id === log.cctvId) || !log.purpose || !log.agency) {
      sendJson(res, 400, { message: "CCTV, 열람 목적, 기관을 확인해 주세요." });
      return;
    }
    db.accessLogs.push(log);
    writeDb(db);
    sendJson(res, 201, log);
    return;
  }

  sendJson(res, 404, { message: "API를 찾을 수 없습니다." });
}

function serveStatic(req, res, url) {
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "접근할 수 없습니다.");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) sendText(res, 404, "파일을 찾을 수 없습니다.");
        else {
          res.writeHead(200, { "Content-Type": contentTypes[".html"] });
          res.end(fallback);
        }
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    sendJson(res, 500, { message: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, () => {
  console.log(`CCTV 열람기록 추적 웹앱 실행 중: http://localhost:${PORT}`);
});
