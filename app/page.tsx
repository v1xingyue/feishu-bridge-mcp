"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";

type DocumentItem = { token: string; name: string; type: string; url?: string; modified_time?: string };
type CalendarItem = { calendar_id: string; summary: string; description?: string; permissions?: "private" | "show_only_free_busy" | "public"; role?: string };
type EventItem = {
  event_id: string;
  summary: string;
  description?: string;
  start_time?: { timestamp?: string; date?: string };
  end_time?: { timestamp?: string; date?: string };
  status?: string;
  app_link?: string;
};
type View = "documents" | "calendar" | "connect";
type CalendarDraft = { id?: string; summary: string; description: string; permissions: "private" | "show_only_free_busy" | "public" };
type ArticleDraft = { id?: string; title: string; content: string };

const TOOL_GROUPS = [
  {
    title: "日历",
    tone: "blue",
    summary: "共享日历的创建、修改和删除",
    actions: ["列表", "创建", "修改", "删除"],
    tools: ["list_calendars", "create_calendar", "update_calendar", "delete_calendar"],
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
  const { data: session, status } = useSession();
  const [view, setView] = useState<View>("documents");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [activeCalendar, setActiveCalendar] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [editingEvent, setEditingEvent] = useState<EventItem | "new" | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [articleDraft, setArticleDraft] = useState<ArticleDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [mcpToken, setMcpToken] = useState("");
  const [mcpCopied, setMcpCopied] = useState<"token" | "config" | "openclaw" | "agent" | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [tokenDays, setTokenDays] = useState(30);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState("");

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/auth/callback/feishu`);
    fetch("/api/status").then((r) => r.json()).then((s) => setConfigured(s.feishuConfigured)).catch(() => setConfigured(false));
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
    try { setEvents((await api(`/api/content?type=events&calendarId=${encodeURIComponent(activeCalendar)}`)).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败"); }
    finally { setLoading(false); }
  }, [activeCalendar, api]);

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
  const agentText = `请连接并使用以下远程 MCP Server：\n\n名称：Workspace Data\n传输协议：Streamable HTTP\nURL：${mcpUrl}\n请求头：Authorization: Bearer ${token}\n\n它提供工作空间文档列表、日历列表、日程查询，以及日程创建、编辑和删除工具。请按照你当前 Agent 客户端支持的远程 MCP 配置方式添加，并在连接后调用 tools/list 验证。此 JWT 有效期为 ${tokenDays} 天，过期后需重新生成。`;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">F</span><span>Feishu Bridge</span></div>
        <nav aria-label="主要导航">
          <button className={view === "documents" ? "nav-item active" : "nav-item"} onClick={() => setView("documents")}><span className="nav-glyph doc-glyph" />文章与文档</button>
          <button className={view === "calendar" ? "nav-item active" : "nav-item"} onClick={() => setView("calendar")}><span className="nav-glyph cal-glyph" />日程</button>
          <button className={view === "connect" ? "nav-item active" : "nav-item"} onClick={() => setView("connect")}><span className="nav-glyph plug-glyph" />MCP 接入</button>
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
              <div className="events-panel"><div className="events-heading"><div><div className="eyebrow">CALENDAR</div><h2>{currentCalendar?.summary || "选择日历"}</h2></div><span>{events.length} 个日程</span></div>{editingEvent && <EventEditor event={editingEvent === "new" ? undefined : editingEvent} onCancel={() => setEditingEvent(null)} onSave={saveEvent} />}<State loading={loading} error={error} empty={!events.length} emptyText="这个日历中暂无可见日程。"><div className="event-list">{events.map((event) => <EventRow key={event.event_id} event={event} onEdit={() => setEditingEvent(event)} onDelete={() => removeEvent(event)} />)}</div></State></div>
            </div>
          </ContentHeader>
        ) : (
          <ContentHeader title="MCP 接入" description="将工作空间文档和日程连接到支持 MCP 的 AI 客户端">
            <div className="connect-grid">
              <section className="connect-card generator-card"><div className="step">READY</div><h2>生成 MCP JWT Token</h2><p>登录验证仍由 NextAuth 负责；MCP JWT 单独使用 <code>MCP_JWT_SECRET</code> 签发。Token 只显示在当前页面。</p><label className="duration-field"><span>Token 有效期</span><select value={tokenDays} onChange={(e) => { setTokenDays(Number(e.target.value)); setMcpToken(""); setTokenExpiresAt(""); }}><option value={30}>30 天 · 短期使用</option><option value={180}>180 天 · 常规使用</option><option value={360}>360 天 · 长期使用</option></select></label><label className="token-field">MCP JWT Token<div><input type="password" readOnly value={mcpToken} placeholder="点击右侧按钮生成" /><button type="button" onClick={generateMcpToken} disabled={tokenLoading}>{tokenLoading ? "生成中…" : mcpToken ? "重新生成" : "生成 JWT"}</button></div></label>{tokenExpiresAt && <div className="token-expiry">有效期至 {new Date(tokenExpiresAt).toLocaleString("zh-CN")}</div>}{tokenError && <div className="form-error" role="alert">{tokenError}</div>}<GeneratedBlock title="JWT Token" value={token} copied={mcpCopied === "token"} onCopy={async () => { await navigator.clipboard.writeText(token); setMcpCopied("token"); }} /><GeneratedBlock title="通用 MCP JSON" value={mcpConfig} copied={mcpCopied === "config"} onCopy={async () => { await navigator.clipboard.writeText(mcpConfig); setMcpCopied("config"); }} /><GeneratedBlock title="OpenClaw JSON（openclaw.json）" value={openClawConfig} copied={mcpCopied === "openclaw"} onCopy={async () => { await navigator.clipboard.writeText(openClawConfig); setMcpCopied("openclaw"); }} /><GeneratedBlock title="发给任意 Agent 的文字说明" value={agentText} copied={mcpCopied === "agent"} onCopy={async () => { await navigator.clipboard.writeText(agentText); setMcpCopied("agent"); }} /></section>
              <section className="connect-card"><div className="step">01</div><h2>部署环境变量</h2><p>登录和 MCP JWT 使用两个互不影响的密钥。</p><Code>{`FEISHU_APP_ID=cli_xxx\nFEISHU_APP_SECRET=xxx\nAUTH_SECRET=NextAuth随机长字符串\nMCP_JWT_SECRET=MCP随机长字符串\nFEISHU_ALLOWED_OPEN_IDS=ou_reader\nFEISHU_ADMIN_OPEN_IDS=ou_admin`}</Code></section>
              <section className="connect-card"><div className="step">02</div><h2>添加 MCP Server</h2><p>Endpoint 使用当前域名，认证方式为 Bearer JWT。</p><Code>{`URL  https://你的域名/api/mcp\nAuthorization  Bearer <JWT_TOKEN>`}</Code></section>
              <section className="connect-card tools-card"><div className="tools-head"><div><div className="step">03</div><h2>可用工具</h2><p>连接成功后可在 Agent 里调用以下 MCP tools。</p></div><strong>{TOOL_GROUPS.reduce((count, group) => count + group.tools.length, 0)} tools</strong></div><div className="tool-groups">{TOOL_GROUPS.map((group) => <ToolGroup key={group.title} group={group} />)}</div></section>
            </div>
          </ContentHeader>
        )}
      </section>
    </main>
  );
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

function EventEditor({ event, onCancel, onSave }: { event?: EventItem; onCancel: () => void; onSave: (input: { summary: string; description: string; start_time: string; end_time: string }) => Promise<void> }) {
  const initialStart = event?.start_time?.timestamp ? new Date(Number(event.start_time.timestamp) * 1000) : new Date(Date.now() + 3600000);
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
function ToolGroup({ group }: { group: typeof TOOL_GROUPS[number] }) { return <article className={`tool-group tone-${group.tone}`}><div className="tool-group-top"><span className="tool-mark">{group.title.slice(0, 1)}</span><div><h3>{group.title}</h3><p>{group.summary}</p></div></div><div className="tool-actions">{group.actions.map((action) => <span key={action}>{action}</span>)}</div><div className="tool-methods">{group.tools.map((tool) => <code key={tool}>{tool}</code>)}</div></article>; }
function fileLabel(type: string) { return ({ doc: "D", docx: "D", sheet: "S", bitable: "B", mindnote: "M", file: "F", folder: "▢" } as Record<string, string>)[type] || "F"; }
function formatTime(value: string) { const date = new Date(Number(value) * 1000); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("zh-CN"); }
function localDateTime(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
