import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordReader, historyInput, requireDiscordScope, snowflakeFromTime } from "../src/lib/discord-reader";
import { registerDiscordTools } from "../src/lib/discord-tools";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";

const guild = "111111111111111111", otherGuild = "222222222222222222", channel = "333333333333333333";
const author = { id: "444444444444444444", username: "Colleague" };
const channelInfo = { id: channel, guild_id: guild, name: "general", type: 0 };
function message(time: string, content = "Please review the draft") { return { id: (BigInt(snowflakeFromTime(time)) + BigInt(1)).toString(), channel_id: channel, type: 0, timestamp: time, content, author }; }
function fixture(responses: unknown[]) {
  const fetcher = vi.fn(async () => { const next = responses.shift(); return next instanceof Response ? next : Response.json(next); });
  return { reader: new DiscordReader("private-baz-token", [{ id: guild, name: "Work" }], fetcher), fetcher };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Baz's read-only Discord access", () => {
  it("blocks unconfigured servers before listing or searching", async () => {
    const { reader, fetcher } = fixture([]);
    await expect(reader.channels(otherGuild)).rejects.toThrow("outside Baz");
    await expect(reader.search({ guild_id: otherGuild, query: "draft", limit: 25, offset: 0 })).rejects.toThrow("outside Baz");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ ...channelInfo, guild_id: otherGuild }, { id: channel, type: 1 }])("does not read history outside the configured servers", async c => {
    const { reader, fetcher } = fixture([c]);
    await expect(reader.history({ channel_id: channel, limit: 50 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a search channel from a different server", async () => {
    const { reader, fetcher } = fixture([{ ...channelInfo, guild_id: otherGuild }]);
    await expect(reader.search({ guild_id: guild, channel_id: channel, query: "draft", limit: 25, offset: 0 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("pages backwards through a busy time window without skipping earlier messages", async () => {
    const newer = message("2026-09-06T12:00:00Z"), middle = message("2026-09-06T10:00:00Z"), older = message("2026-09-06T08:00:00Z"), outside = message("2026-09-05T12:00:00Z");
    const { reader, fetcher } = fixture([channelInfo, [newer, middle], channelInfo, [older, outside]]);
    const since = "2026-09-06T00:00:00Z";
    const first = await reader.history({ channel_id: channel, limit: 2, since });
    expect(first.messages.map(m => m.id)).toEqual([middle.id, newer.id]);
    expect(first.window_complete).toBe(false);
    const second = await reader.history({ channel_id: channel, limit: 2, since, before: first.next_before! });
    expect(second.messages.map(m => m.id)).toEqual([older.id]);
    expect(second.window_complete).toBe(true);
    expect(second.next_before).toBeNull();
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1][0]).not.toContain("after=");
    expect(calls[3][0]).toContain(`before=${middle.id}`);
    for (const [, options] of calls) { expect(options.method).toBe("GET"); expect(options.cache).toBe("no-store"); expect(options.redirect).toBe("error"); expect(options.body).toBeUndefined(); }
    expect(JSON.stringify(first)).not.toContain("private-baz-token");
    expect(first.messages[0].url).toBe(`https://discord.com/channels/${guild}/${channel}/${middle.id}`);
  });
  it("rejects ambiguous pagination and invalid IDs before requesting content", () => {
    expect(historyInput.safeParse({ channel_id: channel, since: "2026-09-06T00:00:00Z", after: author.id }).success).toBe(false);
    expect(historyInput.safeParse({ channel_id: "../tokens", limit: 10 }).success).toBe(false);
    expect(() => snowflakeFromTime("invalid")).toThrow();
  });
  it("does not mistake missing history permission for an empty review", async () => {
    const { reader } = fixture([{ ...channelInfo, last_message_id: author.id }, []]);
    await expect(reader.history({ channel_id: channel, limit: 50, since: "2026-09-06T00:00:00Z" })).rejects.toThrow("coverage gap");
  });
  it("includes active forum threads and returns archived pagination", async () => {
    const thread = { ...channelInfo, id: "555555555555555555", type: 11, parent_id: channel, thread_metadata: { archived: true, archive_timestamp: "2026-09-06T00:00:00Z" } };
    const { reader } = fixture([[{ ...channelInfo, type: 15 }], { threads: [thread] }, channelInfo, { threads: [thread], has_more: true }]);
    const channels = await reader.channels(guild);
    expect(channels.channels.map(c => c.type)).toEqual([15, 11]);
    expect((await reader.archivedThreads(channel, "public")).next_before).toBe(thread.thread_metadata.archive_timestamp);
  });
  it.each([429, 202])("reports incomplete rate-limited or indexing pages (%s) without retrying", async status => {
    const { reader, fetcher } = fixture([new Response(JSON.stringify({ retry_after: 12, sensitive: "must-not-leak" }), { status })]);
    await expect(reader.channels(guild)).rejects.toThrow("retry in 12 seconds");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not echo upstream error bodies or credentials", async () => {
    const { reader } = fixture([new Response("private-baz-token", { status: 500 })]);
    await expect(reader.channels(guild)).rejects.toThrow("HTTP 500");
  });
  it("keeps replies, attachment metadata and embed text as source evidence", async () => {
    const m = { ...message("2026-09-06T12:00:00Z"), message_reference: { message_id: author.id }, attachments: [{ id: author.id, filename: "draft.pdf", size: 10, url: "https://cdn.discordapp.com/attachments/test" }], embeds: [{ title: "Status", description: "Waiting on review" }] };
    const { reader } = fixture([channelInfo, m]);
    const result = await reader.messageById(channel, m.id);
    expect(result.message_reference).toEqual(m.message_reference);
    expect(result.attachments[0].filename).toBe("draft.pdf");
    expect(result.embeds[0].description).toBe("Waiting on review");
  });
  it("paginates search by the documented limit, even if a page is short", async () => {
    const m = message("2026-09-06T12:00:00Z");
    const { reader, fetcher } = fixture([{ total_results: 90, messages: [[m]] }]);
    const result = await reader.search({ guild_id: guild, query: "draft & notes", offset: 25, limit: 25 });
    expect(result.next_offset).toBe(50);
    expect((fetcher.mock.calls as unknown as [string][])[0][0]).toContain("content=draft+%26+notes");
  });
});

describe("Discord MCP permissions", () => {
  it("does not grant Discord access to an existing publishing token", () => {
    expect(() => requireDiscordScope(["projects:read", "projects:write"])).toThrow("Reconnect");
    expect(() => requireDiscordScope(["discord:read"])).not.toThrow();
  });
  it("registers only read tools and refuses missing scope before accessing Discord", async () => {
    const registrations: Record<string, { config: Record<string, unknown>; handler: (args: object, ctx: ServerContext) => Promise<Record<string, unknown>> }> = {};
    const server = { registerTool: (name: string, config: Record<string, unknown>, handler: typeof registrations[string]["handler"]) => { registrations[name] = { config, handler }; } } as unknown as Pick<McpServer, "registerTool">;
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    registerDiscordTools(server, ctx => requireDiscordScope(ctx.http?.authInfo?.scopes ?? []));
    expect(Object.keys(registrations)).toHaveLength(6);
    for (const [name, entry] of Object.entries(registrations)) {
      expect(name).toMatch(/^(list|read|get|search)_discord_/);
      expect(entry.config.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      const result = await entry.handler({}, {} as ServerContext);
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result._meta)).toContain("insufficient_scope");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
