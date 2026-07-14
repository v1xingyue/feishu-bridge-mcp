"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { ToolDefinition, tools as MCP_TOOLS } from "@/lib/mcp-tools";

type DocumentItem = { token: string; name: string; type: string; url?: string; modified_time?: string };
type CalendarItem = { calendar_id: string; summary: string; description?: string; permissions?: "private" | "show_only_free_busy" | "public"; role?: string; type?: string };
type EventItem = {
  event_id: string;
  summary: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  status?: string;
  app_link?: string;
};
type View = "documents" | "calendar" | "watermark" | "connect";
type CalendarDraft = { id?: string; summary: string; description: string; permissions: "private" | "show_only_free_busy" | "public" };
type ArticleDraft = { id?: string; title: string; content: string };

const TOOL_GROUPS = [
  {
    title: "图片",
    tone: "orange",
    summary: "为图片添加可调节的文字水印",
    actions: ["文字水印"],
    tools: ["add_image_watermark"],
  },
  {
    title: "日历",
    tone: "blue",
    summary: "共享日历的创建、修改和删除",
    actions: ["列表", "时间、版本与部署信息", "查看团队日历", "创建", "修改", "删除"],
    tools: ["list_calendars", "get_current_time_and_team_calendar", "get_team_calendar", "create_calendar", "update_calendar", "delete_calendar"],
  },
  {
    title: "日程",
    tone: "green",
    summary: "按日历读取日程，并支持完整管理",
    actions: ["列表", "创建", "编辑", "删除"],
    tools: ["list_calendar_events", "create_calendar_event", "update_calendar_event", "delete_calendar_event"],
  },
  {
    title: "文章",
    tone: "purple",
    summary: "文档文章的 CRUD",
    actions: ["列表", "创建", "读取", "编辑", "删除"],
    tools: ["list_documents", "create_article", "get_article", "update_article", "delete_article"],
  },
] as const;

export default function Home() {
  return <Workspace view="documents" />;
}

export function Workspace({ view }: { view: View }) {
  const { data: session, status } = useSession();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [activeCalendar, setActiveCalendar] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [editingEvent, setEditingEvent] = useState<EventItem | "new" | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [articleDraft, setArticleDraft] = useState<ArticleDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCalendar, setCopiedCalendar] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [mcpCopied, setMcpCopied] = useState<"token" | "config" | "openclaw" | "agent" | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenDays, setTokenDays] = useState(30);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");
  const [watermarkDebugEnabled, setWatermarkDebugEnabled] = useState(false);
  const [watermarkDebugLoading, setWatermarkDebugLoading] = useState(false);
  const [watermarkDebugError, setWatermarkDebugError] = useState("");

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/auth/callback/feishu`);
    fetch("/api/status").then((r) => r.json()).then((s) => { setConfigured(s.feishuConfigured); setWatermarkEnabled(s.watermarkEnabled === true); }).catch(() => setConfigured(false));
    fetch("/api/watermark-debug?status=true").then((r) => r.json()).then((data) => {
      if (typeof data.enabled === "boolean") setWatermarkDebugEnabled(data.enabled);
    }).catch(() => {});
  }, []);

  const api = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "请求失败");
    return body;
  }, []);

  const loadDocuments = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true); setError("");
    try { setDocuments((await api("/api/content?type=documents")).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }, [status, api]);

  const loadCalendars = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true); setError("");
    try {
      const items: CalendarItem[] = (await api("/api/content?type=calendars")).items;
      setCalendars(items);
      if (items[0] && !activeCalendar) setActiveCalendar(items[0].calendar_id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }, [status, activeCalendar, api]);

  const loadEvents = useCallback(async () => {
    if (!activeCalendar) { setEvents([]); return; }
    setLoading(true); setError("");
    const { start, end } = calendarRange(visibleMonth);
    try {
      const query = new URLSearchParams({
        type: "events",
        calendarId: activeCalendar,
        startTime: String(Math.floor(start.getTime() / 1000)),
        endTime: String(Math.floor(end.getTime() / 1000)),
      });
      setEvents((await api(`/api/content?${query}`)).items);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }, [activeCalendar, visibleMonth, api]);

  useEffect(() => { if (view === "documents") loadDocuments(); }, [view, loadDocuments]);
  useEffect(() => { if (view === "calendar") loadCalendars(); }, [view, loadCalendars]);
  useEffect(() => { if (view === "calendar") loadEvents(); }, [view, loadEvents]);

  async function lock() {
    await signOut({ redirect: false });
    setDocuments([]); setEvents([]);
  }

  async function generateMcpToken() {
    setTokenLoading(true); setTokenError(""); setMcpCopied(null);
    try {
      const result = await api("/api/token", { method: "POST", body: JSON.stringify({ days: tokenDays }) });
      setMcpToken(result.token); setTokenExpiresAt(result.expiresAt);
    } catch (cause) { setTokenError(cause instanceof Error ? cause.message : "Token 生成失败"); }
    finally { setTokenLoading(false); }
  }

  async function toggleWatermarkDebug(enabled: boolean) {
    setWatermarkDebugLoading(true); setWatermarkDebugError("");
    try {
      const result = await api("/api/watermark-debug", { method: "POST", body: JSON.stringify({ enabled }) });
      setWatermarkDebugEnabled(result.enabled);
    } catch (cause) { setWatermarkDebugError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setWatermarkDebugLoading(false); }
  }

  async function saveEvent(input: { summary: string; description: string; start_time: string; end_time: string }) {
    const existing = editingEvent === "new" ? null : editingEvent;
    await api("/api/content", {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ ...input, calendarId: activeCalendar, eventId: existing?.event_id }),
    });
    setEditingEvent(null);
    await loadEvents();
  }

  async function removeEvent(event: EventItem) {
    if (!window.confirm(`确定删除“${event.summary || "未命名日程"}”吗？此操作无法撤销。`)) return;
    setLoading(true); setError("");
    try {
      await api("/api/content", { method: "DELETE", body: JSON.stringify({ calendarId: activeCalendar, eventId: event.event_id }) });
      await loadEvents();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败"); }
    finally { setLoading(false); }
  }

  async function saveCalendar(draft: NonNullable<typeof calendarDraft>) {
    await api("/api/content", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify({ resource: "calendar", calendarId: draft.id, ...draft }) });
    setCalendarDraft(null); await loadCalendars();
  }

  async function removeCalendar(calendar: CalendarItem) {
    if (!window.confirm(`确定删除日历“${calendar.summary}”吗？`)) return;
    await api("/api/content", { method: "DELETE", body: JSON.stringify({ resource: "calendar", calendarId: calendar.calendar_id }) });
    if (activeCalendar === calendar.calendar_id) setActiveCalendar("");
    await loadCalendars();
  }

  async function editArticle(item?: DocumentItem) {
    if (!item) { setArticleDraft({ title: "", content: "" }); return; }
    setLoading(true); setError("");
    try {
      const result = await api(`/api/content?type=article&documentId=${encodeURIComponent(item.token)}`);
      setArticleDraft({ id: item.token, title: result.document?.title || item.name, content: result.content || "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取文章失败"); }
    finally { setLoading(false); }
  }

  async function saveArticle(draft: NonNullable<typeof articleDraft>) {
    await api("/api/content", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify({ resource: "article", documentId: draft.id, ...draft }) });
    setArticleDraft(null); await loadDocuments();
  }

  async function removeArticle(item: DocumentItem) {
    if (!window.confirm(`确定删除文章“${item.name}”吗？`)) return;
    await api("/api/content", { method: "DELETE", body: JSON.stringify({ resource: "article", documentId: item.token }) });
    await loadDocuments();
  }

  const currentCalendar = calendars.find((item) => item.calendar_id === activeCalendar);
  const mcpUrl = `${callbackUrl.split("/api/auth/")[0]}/api/mcp`;
  const token = mcpToken || "<JWT_TOKEN>";
  const mcpConfig = JSON.stringify({ mcpServers: { workspace_data: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  const openClawConfig = JSON.stringify({ mcp: { servers: { workspace_data: { url: mcpUrl, transport: "streamable-http", headers: { Authorization: `Bearer ${token}` } } } } }, null, 2);
  const agentText = `请连接并使用以下远程 MCP Server：\n\n名称：Workspace Data\n传输协议：Streamable HTTP\nURL：${mcpUrl}\n请求头：Authorization: Bearer ${token}\n\n它提供工作空间文档、日历和日程管理工具。请按照你当前 Agent 客户端支持的远程 MCP 配置方式添加，并在连接后调用 tools/list 验证。此 JWT 有效期为 ${tokenDays} 天，过期后需重新生成。`;
  const availableGroups = watermarkEnabled ? TOOL_GROUPS : TOOL_GROUPS.filter((group) => group.title !== "图片");
  const availableToolCount = MCP_TOOLS.length - (watermarkEnabled ? 0 : 1);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">F</span><span>Feishu Bridge</span></div>
        <nav aria-label="主要导航">
          <a href="/documents" className={view === "documents" ? "nav-item active" : "nav-item"}><span className="nav-glyph doc-glyph" />文章与文档</a>
          <a href="/calendar" className={view === "calendar" ? "nav-item active" : "nav-item"}><span className="nav-glyph cal-glyph" />日程</a>
          {watermarkEnabled && <a href="/watermark" className={view === "watermark" ? "nav-item active" : "nav-item"}><span className="nav-glyph image-glyph" />图片水印</a>}
          <a href="/connect" className={view === "connect" ? "nav-item active" : "nav-item"}><span className="nav-glyph plug-glyph" />MCP 接入</a>
        </nav>
        <div className="sidebar-bottom">
          <span className={`status-dot ${configured ? "online" : ""}`} />
          <span>{configured === null ? "正在检查配置" : configured ? "飞书服务已连接" : "等待环境配置"}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">F</span> Feishu Bridge</div>
          <div className="top-actions"><span className="safe-label">{status === "authenticated" ? `${session.user?.name || "飞书用户"} · ${(session.user as { openId?: string })?.openId || "请重新登录以获取 open_id"}` : "飞书 OAuth 安全会话"}</span>{status === "authenticated" && <button className="quiet-button" onClick={lock}>退出登录</button>}</div>
        </header>

        {status !== "authenticated" ? (
          <section className="unlock-panel">
            <div className="eyebrow">SECURE WORKSPACE</div>
            <h1>连接你的飞书工作空间</h1>
            <p>{status === "loading" ? "正在恢复安全会话…" : "使用飞书账号登录，仅用于确认身份；文档与日程由应用 Bot 的权限读取和管理。"}</p>
            <div className="redirect-hint"><span>请在飞书应用的「安全设置 → 重定向 URL」中添加</span><div><code>{callbackUrl || "正在生成…"}</code><button type="button" onClick={async () => { await navigator.clipboard.writeText(callbackUrl); setCopied(true); }} disabled={!callbackUrl}>{copied ? "已复制" : "复制"}</button></div></div>
            <button className="oauth-button" onClick={() => signIn("feishu")} disabled={status === "loading"}><span className="brand-mark">F</span>使用飞书账号登录</button>
            {!configured && configured !== null && <div className="config-warning">服务端尚未配置飞书应用凭据。</div>}
          </section>
        ) : view === "documents" ? (
          <ContentHeader title="文章与文档" description="飞书云空间根目录中的最新内容" action={<div className="header-actions"><button className="quiet-button" onClick={loadDocuments}>刷新</button><button className="primary-button" onClick={() => editArticle()}>新建文章</button></div>}>
            {articleDraft && <ArticleEditor draft={articleDraft} onChange={setArticleDraft} onCancel={() => setArticleDraft(null)} onSave={saveArticle} />}
            <div className="summary-row"><Stat value={documents.length} label="当前内容" /><Stat value={documents.filter((x) => x.type === "docx" || x.type === "doc").length} label="文档" /><Stat value={documents.filter((x) => x.type === "sheet").length} label="表格" /></div>
            <State loading={loading} error={error} empty={!documents.length} emptyText="这里还没有可访问的内容。请确认应用已获得云空间权限。">
              <div className="card-grid">{documents.map((item) => <DocumentCard key={item.token} item={item} onEdit={() => editArticle(item)} onDelete={() => removeArticle(item)} />)}</div>
            </State>
          </ContentHeader>
        ) : view === "calendar" ? (
          <ContentHeader title="日程" description="查看并管理应用可访问的飞书日程" action={<div className="header-actions"><button className="quiet-button" onClick={loadEvents}>刷新</button><button className="primary-button" onClick={() => setEditingEvent("new")} disabled={!activeCalendar}>新建日程</button></div>}>
            <div className="calendar-layout">
              <div className="calendar-list"><div className="calendar-list-head"><div className="section-label">我的日历</div><button onClick={() => setCalendarDraft({ summary: "", description: "", permissions: "private" })}>＋</button></div>{calendarDraft && <CalendarEditor draft={calendarDraft} onChange={setCalendarDraft} onCancel={() => setCalendarDraft(null)} onSave={saveCalendar} />}{calendars.map((calendar) => <div className="calendar-row" key={calendar.calendar_id}><button className={activeCalendar === calendar.calendar_id ? "calendar-choice selected" : "calendar-choice"} onClick={() => setActiveCalendar(calendar.calendar_id)}><span className="calendar-color" /> <span>{calendar.summary || "未命名日历"}</span></button><div><button onClick={() => setCalendarDraft({ id: calendar.calendar_id, summary: calendar.summary, description: calendar.description || "", permissions: calendar.permissions || "private" })}>编辑</button><button onClick={() => removeCalendar(calendar)}>删</button></div></div>)}</div>
              <div className="events-panel"><div className="events-heading"><div><div className="eyebrow">CALENDAR</div><h2>{currentCalendar?.summary || "选择日历"}</h2></div><span>{events.length} 个日程</span></div>{currentCalendar && (currentCalendar.type === "primary" ? <div className="calendar-subscribe"><div><strong>无法订阅</strong><p>这是机器人主日历。飞书不允许其他用户订阅机器人主日历。</p></div></div> : <div className="calendar-subscribe"><div><strong>订阅此日历</strong><p>{currentCalendar.permissions === "private" ? "当前为私密日历，不能被订阅。请先将权限改为「公开」或「仅忙闲」。" : "在飞书日历左侧点击「＋」→「订阅日历」，搜索此日历名称。"}</p><small>日历 ID（仅供 API 使用）</small><code>{currentCalendar.calendar_id}</code></div>{currentCalendar.permissions === "private" ? <button type="button" onClick={() => setCalendarDraft({ id: currentCalendar.calendar_id, summary: currentCalendar.summary, description: currentCalendar.description || "", permissions: "private" })}>修改权限</button> : <button type="button" onClick={async () => { await navigator.clipboard.writeText(currentCalendar.summary); setCopiedCalendar(currentCalendar.calendar_id); }}>{copiedCalendar === currentCalendar.calendar_id ? "已复制名称" : "复制日历名称"}</button>}</div>)}{editingEvent && <EventEditor event={editingEvent === "new" ? undefined : editingEvent} initialDate={parseDateKey(selectedDate)} onCancel={() => setEditingEvent(null)} onSave={saveEvent} />}<State loading={loading} error={error} empty={!activeCalendar} emptyText="请先选择一个日历。"><MonthCalendar month={visibleMonth} selectedDate={selectedDate} events={events} onMonthChange={(month) => { setVisibleMonth(month); setSelectedDate(dateKey(isSameMonth(month, new Date()) ? new Date() : month)); }} onSelectDate={setSelectedDate} onCreate={() => setEditingEvent("new")} onEdit={(event) => setEditingEvent(event)} onDelete={removeEvent} /></State></div>
            </div>
          </ContentHeader>
        ) : view === "watermark" ? (
          watermarkEnabled ? <ContentHeader title="图片水印" description="上传图片，通过 MCP 后端添加文字水印"><WatermarkEditor /></ContentHeader> : <ContentHeader title="图片水印暂不可用" description="此功能当前已关闭。" ><div className="state">需要时设置 WATERMARK_ENABLED=1 后重新部署。</div></ContentHeader>
        ) : (
          <ContentHeader title="MCP 接入" description="将工作空间文档和日程连接到支持 MCP 的 AI 客户端">
            <div className="connect-grid">
              <section className="connect-card generator-card"><div className="step">READY</div><h2>生成 MCP JWT Token</h2><p>登录验证仍由 NextAuth 负责；MCP JWT 单独使用 <code>MCP_JWT_SECRET</code> 签发。Token 只显示在当前页面。</p><label className="duration-field"><span>Token 有效期</span><select value={tokenDays} onChange={(e) => { setTokenDays(Number(e.target.value)); setMcpToken(""); setTokenExpiresAt(""); }}><option value={30}>30 天 · 短期使用</option><option value={180}>180 天 · 常规使用</option><option value={360}>360 天 · 长期使用</option></select></label><label className="token-field">MCP JWT Token<div><input type="password" readOnly value={mcpToken} placeholder="点击右侧按钮生成" /><button type="button" onClick={generateMcpToken} disabled={tokenLoading}>{tokenLoading ? "生成中…" : mcpToken ? "重新生成" : "生成 JWT"}</button></div></label>{tokenExpiresAt && <div className="token-expiry">有效期至 {new Date(tokenExpiresAt).toLocaleString("zh-CN")}</div>}{tokenError && <div className="form-error" role="alert">{tokenError}</div>}<GeneratedBlock title="JWT Token" value={token} copied={mcpCopied === "token"} onCopy={async () => { await navigator.clipboard.writeText(token); setMcpCopied("token"); }} /><GeneratedBlock title="通用 MCP JSON" value={mcpConfig} copied={mcpCopied === "config"} onCopy={async () => { await navigator.clipboard.writeText(mcpConfig); setMcpCopied("config"); }} /><GeneratedBlock title="OpenClaw JSON（openclaw.json）" value={openClawConfig} copied={mcpCopied === "openclaw"} onCopy={async () => { await navigator.clipboard.writeText(openClawConfig); setMcpCopied("openclaw"); }} /><GeneratedBlock title="发给任意 Agent 的文字说明" value={agentText} copied={mcpCopied === "agent"} onCopy={async () => { await navigator.clipboard.writeText(agentText); setMcpCopied("agent"); }} /></section>
              {watermarkEnabled && <section className="connect-card"><div className="step">DEBUG</div><h2>水印调试接口</h2><p>开启后，可以直接通过浏览器访问以下接口预览中文字体和水印效果：</p><div style={{ margin: "12px 0", wordBreak: "break-all" }}><code>{`${window.location.origin}/api/watermark-debug`}</code></div><div className="toggle-field" style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "16px" }}><label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", gap: "8px" }}><input type="checkbox" checked={watermarkDebugEnabled} disabled={watermarkDebugLoading} onChange={(e) => toggleWatermarkDebug(e.target.checked)} style={{ width: "18px", height: "18px", cursor: "pointer" }} /><span>{watermarkDebugEnabled ? "已开启" : "已关闭"}</span></label>{watermarkDebugLoading && <span className="spinner-mini" style={{ border: "2px solid #ccc", borderTop: "2px solid #3b82f6", borderRadius: "50%", width: "14px", height: "14px", animation: "spin 1s linear infinite" }} />}</div>{watermarkDebugError && <div className="form-error" style={{ marginTop: "12px", color: "#ef4444" }} role="alert">{watermarkDebugError}</div>}</section>}
              <section className="connect-card"><div className="step">01</div><h2>部署环境变量</h2><p>登录和 MCP JWT 使用两个互不影响的密钥。</p><Code>{`FEISHU_APP_ID=cli_xxx\nFEISHU_APP_SECRET=xxx\nAUTH_SECRET=NextAuth随机长字符串\nMCP_JWT_SECRET=MCP随机长字符串\nFEISHU_ALLOWED_OPEN_IDS=ou_reader\nFEISHU_ADMIN_OPEN_IDS=ou_admin`}</Code></section>
              <section className="connect-card"><div className="step">02</div><h2>添加 MCP Server</h2><p>Endpoint 使用当前域名，认证方式为 Bearer JWT。</p><Code>{`URL  https://你的域名/api/mcp\nAuthorization  Bearer <JWT_TOKEN>`}</Code></section>
              <section className="connect-card tools-card"><div className="tools-head"><div><div className="step">03</div><h2>可用工具</h2><p>点击工具名称查看功能描述、必填参数和取值限制。</p></div><strong>{availableToolCount} tools</strong></div><div className="tool-groups">{availableGroups.map((group) => <ToolGroup key={group.title} group={group} />)}</div></section>
            </div>
          </ContentHeader>
        )}
      </section>
    </main>
  );
}

function WatermarkEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [text, setText] = useState("");
  const [position, setPosition] = useState("bottom-right");
  const [fontSize, setFontSize] = useState("");
  const [result, setResult] = useState<{ data: string; mimeType: string; details?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); }, [sourceUrl]);

  function chooseFile(next: File | null) {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(next); setSourceUrl(next ? URL.createObjectURL(next) : ""); setResult(null); setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setResult(null);
    if (!file) return setError("请先选择图片");
    if (file.size > 3 * 1024 * 1024) return setError("图片不能超过 3 MB");
    setLoading(true);
    try {
      const response = await fetch("/api/watermark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_base64: await fileBase64(file), text, position, font_size: fontSize ? Number(fontSize) : undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "水印处理失败");
      setResult(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "水印处理失败"); }
    finally { setLoading(false); }
  }

  return <div className="watermark-layout">
    <form className="watermark-panel" onSubmit={submit}>
      <label className="upload-field"><span>{file ? file.name : "选择 JPG、PNG 或 WebP 图片"}</span><small>最大 3 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0] || null)} /></label>
      <label>水印文字<input value={text} onChange={(event) => setText(event.target.value)} required maxLength={40} placeholder="例如：仅供内部使用" /></label>
      <div className="watermark-fields">
        <label>位置<select value={position} onChange={(event) => setPosition(event.target.value)}>{Object.entries(WATERMARK_POSITIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>字号（可选）<input type="number" min={1} value={fontSize} onChange={(event) => setFontSize(event.target.value)} placeholder="自动" /></label>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="primary-button" disabled={loading}>{loading ? "MCP 处理中…" : "添加水印"}</button>
    </form>
    <section className="watermark-preview" aria-live="polite">
      {result ? <><img src={`data:${result.mimeType};base64,${result.data}`} alt="添加水印后的图片" /><div><span>{result.details || "处理完成"}</span><a className="primary-button" href={`data:${result.mimeType};base64,${result.data}`} download={`watermarked-${file?.name.replace(/\.[^.]+$/, "") || "image"}.webp`}>下载 WebP</a></div></> : sourceUrl ? <><img src={sourceUrl} alt="待处理的原始图片预览" /><p>原图预览</p></> : <div className="watermark-empty">选择图片后在这里预览</div>}
    </section>
  </div>;
}

const WATERMARK_POSITIONS = { "top-left": "左上", "top-center": "上中", "top-right": "右上", "center-left": "左中", center: "居中", "center-right": "右中", "bottom-left": "左下", "bottom-center": "下中", "bottom-right": "右下" };

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function ContentHeader({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <div className="content"><div className="page-heading"><div><div className="eyebrow">FEISHU WORKSPACE</div><h1>{title}</h1><p>{description}</p></div>{action}</div>{children}</div>;
}

function Stat({ value, label }: { value: number; label: string }) { return <div className="stat"><strong>{String(value).padStart(2, "0")}</strong><span>{label}</span></div>; }

function State({ loading, error, empty, emptyText, children }: { loading: boolean; error: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  if (loading) return <div className="state"><span className="spinner" />正在同步飞书数据…</div>;
  if (error) return <div className="state error-state"><ErrorMessage message={error} /></div>;
  if (empty) return <div className="state">{emptyText}</div>;
  return children;
}

function ErrorMessage({ message }: { message: string }) {
  return <div>{message.split("\n").map((line) => line.startsWith("申请权限：http") ? <a key={line} href={line.slice(5)} target="_blank" rel="noreferrer">一键申请飞书权限</a> : <div key={line}>{line}</div>)}</div>;
}

function DocumentCard({ item, onEdit, onDelete }: { item: DocumentItem; onEdit: () => void; onDelete: () => void }) {
  return <article className="document-card"><div className={`file-icon type-${item.type}`}>{fileLabel(item.type)}</div><div className="file-meta"><span>{item.type.toUpperCase()}</span>{item.modified_time && <span>更新于 {formatTime(item.modified_time)}</span>}</div><h2>{item.name || "未命名内容"}</h2><div className="document-actions">{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开</a>}{item.type === "docx" && <><button onClick={onEdit}>编辑</button><button className="danger-action" onClick={onDelete}>删除</button></>}</div></article>;
}

function ArticleEditor({ draft, onChange, onCancel, onSave }: { draft: ArticleDraft; onChange: (value: ArticleDraft) => void; onCancel: () => void; onSave: (value: ArticleDraft) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); setFormError(""); try { await onSave(draft); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "保存失败"); } finally { setSaving(false); } }
  return <form className="event-editor article-editor" onSubmit={submit}><div className="editor-heading"><h3>{draft.id ? "编辑文章" : "新建文章"}</h3><button type="button" onClick={onCancel}>关闭</button></div><label>标题<input value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} required maxLength={200} /></label><label>正文<textarea value={draft.content} onChange={(e) => onChange({ ...draft, content: e.target.value })} rows={8} /></label>{formError && <div className="form-error">{formError}</div>}<div className="editor-actions"><button type="button" className="quiet-button" onClick={onCancel}>取消</button><button className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存文章"}</button></div></form>;
}

function CalendarEditor({ draft, onChange, onCancel, onSave }: { draft: CalendarDraft; onChange: (value: CalendarDraft) => void; onCancel: () => void; onSave: (value: CalendarDraft) => Promise<void> }) {
  const [saving, setSaving] = useState(false); const [formError, setFormError] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); setFormError(""); try { await onSave(draft); } catch (cause) { setFormError(cause instanceof Error ? cause.message : "保存失败"); } finally { setSaving(false); } }
  return <form className="calendar-editor" onSubmit={submit}><input aria-label="日历名称" value={draft.summary} onChange={(e) => onChange({ ...draft, summary: e.target.value })} placeholder="日历名称" required /><textarea aria-label="日历描述" value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} placeholder="描述" rows={2} /><select aria-label="日历权限" value={draft.permissions} onChange={(e) => onChange({ ...draft, permissions: e.target.value as typeof draft.permissions })}><option value="private">私密</option><option value="show_only_free_busy">仅忙闲</option><option value="public">公开</option></select>{formError && <div className="form-error">{formError}</div>}<div><button type="button" onClick={onCancel}>取消</button><button disabled={saving}>{saving ? "…" : "保存"}</button></div></form>;
}

function EventRow({ event, onEdit, onDelete }: { event: EventItem; onEdit: () => void; onDelete: () => void }) {
  const start = event.start_time?.timestamp ? new Date(Number(event.start_time.timestamp) * 1000) : null;
  return <div className="event-row"><div className="event-date"><strong>{start ? String(start.getDate()).padStart(2, "0") : "--"}</strong><span>{start ? start.toLocaleDateString("zh-CN", { month: "short" }) : "全天"}</span></div><div className="event-copy"><h3>{event.summary || "未命名日程"}</h3><p>{start ? start.toLocaleString("zh-CN", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : event.start_time?.date || "时间待定"}{event.description ? ` · ${event.description}` : ""}</p></div><div className="event-actions">{event.app_link && <a href={event.app_link} target="_blank" rel="noreferrer">打开</a>}<button onClick={onEdit}>编辑</button><button className="danger-action" onClick={onDelete}>删除</button></div></div>;
}

function MonthCalendar({ month, selectedDate, events, onMonthChange, onSelectDate, onCreate, onEdit, onDelete }: { month: Date; selectedDate: string; events: EventItem[]; onMonthChange: (month: Date) => void; onSelectDate: (date: string) => void; onCreate: () => void; onEdit: (event: EventItem) => void; onDelete: (event: EventItem) => void }) {
  const { start } = calendarRange(month);
  const days = Array.from({ length: 42 }, (_, index) => addDays(start, index));
  const grouped = new Map<string, EventItem[]>();
  for (const event of events) {
    const key = eventDateKey(event);
    if (key) grouped.set(key, [...(grouped.get(key) || []), event]);
  }
  for (const items of grouped.values()) items.sort((a, b) => eventTime(a) - eventTime(b));
  const selectedEvents = grouped.get(selectedDate) || [];
  const today = dateKey(new Date());

  return <div className="month-view">
    <div className="month-toolbar">
      <div><strong>{month.toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</strong><span>按日期查看日程安排</span></div>
      <div className="month-navigation"><button type="button" onClick={() => onMonthChange(addMonths(month, -1))} aria-label="上个月">‹</button><button type="button" className="today-button" onClick={() => onMonthChange(monthStart(new Date()))}>今天</button><button type="button" onClick={() => onMonthChange(addMonths(month, 1))} aria-label="下个月">›</button></div>
    </div>
    <div className="month-grid" role="grid" aria-label={`${month.getFullYear()} 年 ${month.getMonth() + 1} 月日历`}>
      {["一", "二", "三", "四", "五", "六", "日"].map((weekday) => <div className="weekday" role="columnheader" key={weekday}>周{weekday}</div>)}
      {days.map((day) => {
        const key = dateKey(day); const items = grouped.get(key) || []; const selected = key === selectedDate;
        return <div role="gridcell" aria-selected={selected} className={`day-cell${isSameMonth(day, month) ? "" : " outside-month"}${key === today ? " today" : ""}${selected ? " selected-day" : ""}`} key={key} onClick={() => onSelectDate(key)}>
          <button type="button" className="day-number" onClick={() => onSelectDate(key)} aria-label={`选择 ${day.toLocaleDateString("zh-CN")}`}>{day.getDate()}</button>
          <div className="day-events">{items.slice(0, 3).map((event) => <button type="button" className="event-chip" key={event.event_id} onClick={(click) => { click.stopPropagation(); onSelectDate(key); }} title={event.summary || "未命名日程"}><span>{formatEventTime(event)}</span>{event.summary || "未命名日程"}</button>)}{items.length > 3 && <button type="button" className="more-events" onClick={(click) => { click.stopPropagation(); onSelectDate(key); }}>另有 {items.length - 3} 项</button>}</div>
        </div>;
      })}
    </div>
    <section className="selected-day-agenda" aria-live="polite">
      <div className="agenda-heading"><div><span>{parseDateKey(selectedDate).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</span><strong>{selectedEvents.length ? `${selectedEvents.length} 个日程` : "当天暂无日程"}</strong></div><button type="button" className="primary-button" onClick={onCreate}>在当天新建</button></div>
      {selectedEvents.length > 0 && <div className="event-list">{selectedEvents.map((event) => <EventRow key={event.event_id} event={event} onEdit={() => onEdit(event)} onDelete={() => onDelete(event)} />)}</div>}
    </section>
  </div>;
}

function EventEditor({ event, initialDate, onCancel, onSave }: { event?: EventItem; initialDate?: Date; onCancel: () => void; onSave: (input: { summary: string; description: string; start_time: string; end_time: string }) => Promise<void> }) {
  const defaultStart = initialDate ? new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 9) : new Date(Date.now() + 3600000);
  const initialStart = event?.start_time?.timestamp ? new Date(Number(event.start_time.timestamp) * 1000) : defaultStart;
  const initialEnd = event?.end_time?.timestamp ? new Date(Number(event.end_time.timestamp) * 1000) : new Date(initialStart.getTime() + 7200000);
  const [summary, setSummary] = useState(event?.summary || "");
  const [description, setDescription] = useState(event?.description || "");
  const [start, setStart] = useState(localDateTime(initialStart));
  const [end, setEnd] = useState(localDateTime(initialEnd));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setFormError("");
    try {
      const startTime = new Date(start).getTime(); const endTime = new Date(end).getTime();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) throw new Error("结束时间必须晚于开始时间");
      await onSave({ summary, description, start_time: String(Math.floor(startTime / 1000)), end_time: String(Math.floor(endTime / 1000)) });
    } catch (cause) { setFormError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setSaving(false); }
  }

  return <form className="event-editor" onSubmit={submit}><div className="editor-heading"><h3>{event ? "编辑日程" : "新建日程"}</h3><button type="button" onClick={onCancel} aria-label="关闭日程表单">关闭</button></div><label>标题<input value={summary} onChange={(e) => setSummary(e.target.value)} required maxLength={100} /></label><label>备注<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} /></label><div className="time-fields"><label>开始时间<input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required /></label><label>结束时间<input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required /></label></div>{formError && <div className="form-error" role="alert">{formError}</div>}<div className="editor-actions"><button type="button" className="quiet-button" onClick={onCancel}>取消</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "保存中…" : "保存日程"}</button></div></form>;
}

function Code({ children }: { children: string }) { return <pre><code>{children}</code></pre>; }
function GeneratedBlock({ title, value, copied, onCopy }: { title: string; value: string; copied: boolean; onCopy: () => void }) { return <div className="generated-block"><div><strong>{title}</strong><button type="button" onClick={onCopy}>{copied ? "已复制" : "复制"}</button></div><pre><code>{value}</code></pre></div>; }
function ToolGroup({ group }: { group: typeof TOOL_GROUPS[number] }) { return <article className={`tool-group tone-${group.tone}`}><div className="tool-group-top"><span className="tool-mark">{group.title.slice(0, 1)}</span><div><h3>{group.title}</h3><p>{group.summary}</p></div></div><div className="tool-actions">{group.actions.map((action) => <span key={action}>{action}</span>)}</div><div className="tool-methods">{group.tools.map((name) => <ToolDetails key={name} tool={MCP_TOOLS.find((tool) => tool.name === name)!} />)}</div></article>; }
function ToolDetails({ tool }: { tool: ToolDefinition }) {
  const required = new Set(tool.inputSchema.required || []);
  const parameters = Object.entries(tool.inputSchema.properties);
  return <details className="tool-method"><summary><code>{tool.name}</code><span>详情</span></summary><div className="tool-detail"><p>{tool.description}</p><h4>参数</h4>{parameters.length ? <dl>{parameters.map(([name, property]) => <div key={name}><dt><code>{name}</code><span className={required.has(name) ? "required" : "optional"}>{required.has(name) ? "必填" : "可选"}</span></dt><dd><strong>{property.type}</strong> · {property.description}{propertyRules(property)}</dd></div>)}</dl> : <p className="no-params">无需参数</p>}</div></details>;
}
function propertyRules(property: ToolDefinition["inputSchema"]["properties"][string]) {
  const rules = [property.enum && `可选值：${property.enum.join("、")}`, property.default !== undefined && `默认：${String(property.default)}`, property.minimum !== undefined && property.maximum !== undefined && `范围：${property.minimum}–${property.maximum}`, property.maxLength !== undefined && `最长：${property.maxLength} 字符`].filter(Boolean);
  return rules.length ? `（${rules.join("；")}）` : "";
}
function fileLabel(type: string) { return ({ doc: "D", docx: "D", sheet: "S", bitable: "B", mindnote: "M", file: "F", folder: "▢" } as Record<string, string>)[type] || "F"; }
function formatTime(value: string) { const date = new Date(Number(value) * 1000); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("zh-CN"); }
function localDateTime(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function monthStart(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function addMonths(date: Date, amount: number) { return new Date(date.getFullYear(), date.getMonth() + amount, 1); }
function addDays(date: Date, amount: number) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function isSameMonth(left: Date, right: Date) { return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth(); }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function parseDateKey(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function calendarRange(month: Date) { const first = monthStart(month); const start = addDays(first, -((first.getDay() + 6) % 7)); return { start, end: addDays(start, 42) }; }
function eventTime(event: EventItem) { return event.start_time?.timestamp ? Number(event.start_time.timestamp) : parseDateKey(event.start_time?.date || "1970-01-01").getTime() / 1000; }
function eventDateKey(event: EventItem) { if (event.start_time?.timestamp) return dateKey(new Date(Number(event.start_time.timestamp) * 1000)); return event.start_time?.date || ""; }
function formatEventTime(event: EventItem) { if (!event.start_time?.timestamp) return "全天"; return new Date(Number(event.start_time.timestamp) * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
