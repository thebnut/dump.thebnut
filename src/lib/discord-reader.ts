import { z } from "zod";

export const discordId = z.string().regex(/^\d{17,20}$/);
const guildsSchema = z.array(z.object({ id: discordId, name: z.string().min(1).max(100) })).min(1).max(100);
const channelSchema = z.object({
  id: discordId, guild_id: discordId.optional(), name: z.string().optional(),
  type: z.number(), parent_id: discordId.nullish(), last_message_id: discordId.nullish(),
  topic: z.string().nullish(), thread_metadata: z.object({ archived: z.boolean() }).optional(),
});
type Channel = z.infer<typeof channelSchema>;
const userSchema = z.object({ id: discordId, username: z.string(), global_name: z.string().nullish(), bot: z.boolean().optional() });
const messageSchema = z.object({
  id: discordId, channel_id: discordId, type: z.number(), timestamp: z.string(),
  edited_timestamp: z.string().nullish(), content: z.string().default(""), author: userSchema,
  mentions: z.array(userSchema).default([]), hit: z.boolean().optional(),
  attachments: z.array(z.object({ id: discordId, filename: z.string(), content_type: z.string().optional(), size: z.number(), url: z.string().url() })).default([]),
  embeds: z.array(z.object({ title: z.string().optional(), description: z.string().optional(), url: z.string().optional(), fields: z.array(z.object({ name: z.string(), value: z.string() })).optional() })).default([]),
  message_reference: z.object({ message_id: discordId.optional(), channel_id: discordId.optional(), guild_id: discordId.optional() }).optional(),
});

export class DiscordReadError extends Error {}
export class DiscordScopeError extends DiscordReadError {}
export function requireDiscordScope(scopes: readonly string[]) {
  if (!scopes.includes("discord:read")) throw new DiscordScopeError("Reconnect Brett Toolkit and allow Read Discord messages to use Baz's existing access.");
}

export function discordReaderFromEnv() {
  const token = process.env.BAZ_DISCORD_BOT_TOKEN?.trim();
  let guilds: z.infer<typeof guildsSchema>;
  try { guilds = guildsSchema.parse(JSON.parse(process.env.BAZ_DISCORD_GUILDS ?? "")); }
  catch { throw new DiscordReadError("Baz's cloud Discord server list is not configured."); }
  if (!token) throw new DiscordReadError("Baz's cloud Discord credential is not configured.");
  return new DiscordReader(token, guilds);
}

export function snowflakeFromTime(time: string) {
  const milliseconds = Date.parse(time);
  if (!Number.isFinite(milliseconds) || milliseconds < 1420070400000) throw new DiscordReadError("Discord time must be a valid date from 2015 onwards.");
  return ((BigInt(milliseconds) - BigInt(1420070400000)) << BigInt(22)).toString();
}

export const historyInput = z.object({
  channel_id: discordId,
  limit: z.number().int().min(1).max(100).default(50),
  before: discordId.optional(), after: discordId.optional(), around: discordId.optional(),
  since: z.iso.datetime({ offset: true }).optional(),
}).refine(v => [v.before, v.after, v.around].filter(Boolean).length <= 1 && !(v.since && (v.after || v.around)), "Choose before, after or around; since can be combined only with before.");

export const searchInput = z.object({
  guild_id: discordId, query: z.string().min(1).max(1024), channel_id: discordId.optional(),
  author_id: discordId.optional(), since: z.iso.datetime({ offset: true }).optional(),
  before: z.iso.datetime({ offset: true }).optional(), offset: z.number().int().min(0).max(9975).default(0),
  limit: z.number().int().min(1).max(25).default(25),
});

export class DiscordReader {
  constructor(private token: string, private guilds: z.infer<typeof guildsSchema>, private transport: typeof fetch = fetch) {
    guildsSchema.parse(guilds);
  }

  servers() { return { servers: this.guilds, access: "Existing Baz bot; read-only cloud tools", personal_dms: false }; }

  private guild(id: string) {
    discordId.parse(id);
    const guild = this.guilds.find(g => g.id === id);
    if (!guild) throw new DiscordReadError("Discord server is outside Baz's configured review scope.");
    return guild;
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(`https://discord.com/api/v10${path}`, {
        method: "GET", headers: { Authorization: `Bot ${this.token}`, "User-Agent": "BrettToolkitDiscord/1.0" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000),
      });
    } catch { throw new DiscordReadError("Discord could not be reached. Retry the bounded read later."); }
    if (response.status === 429 || response.status === 202) {
      let retry = Number(response.headers.get("retry-after"));
      try { const body = await response.json(); retry = Number(body.retry_after ?? retry); } catch {}
      throw new DiscordReadError(`Discord ${response.status === 429 ? "rate limit" : "search indexing"}; retry in ${Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 5} seconds. This page has not been reviewed.`);
    }
    if ([403, 404].includes(response.status)) throw new DiscordReadError("Discord channel or message is unavailable to Baz. Report this as a coverage gap.");
    if (response.status === 401) throw new DiscordReadError("Baz's cloud Discord credential needs updating.");
    if (!response.ok) throw new DiscordReadError(`Discord read failed (HTTP ${response.status}). Retry later.`);
    try { return await response.json(); } catch { throw new DiscordReadError("Discord returned an invalid response. This page has not been reviewed."); }
  }

  private async channel(id: string, expectedGuild?: string) {
    discordId.parse(id);
    const channel = channelSchema.parse(await this.get(`/channels/${id}`));
    if (!channel.guild_id) throw new DiscordReadError("Personal and bot DMs are outside this server-review connection.");
    this.guild(channel.guild_id);
    if (expectedGuild && channel.guild_id !== expectedGuild) throw new DiscordReadError("Discord channel does not belong to the requested server.");
    return channel;
  }

  private describeChannel(c: Channel, guildId: string) {
    return { ...c, guild_id: guildId, server_name: this.guild(guildId).name,
      url: `https://discord.com/channels/${guildId}/${c.id}`, history_access: "Checked when reading; channel listing alone does not prove history access" };
  }

  async channels(guildId: string) {
    this.guild(guildId);
    const channels = z.array(channelSchema).parse(await this.get(`/guilds/${guildId}/channels`));
    const active = z.object({ threads: z.array(channelSchema) }).parse(await this.get(`/guilds/${guildId}/threads/active`));
    return { channels: [...channels.filter(c => [0, 5, 15, 16].includes(c.type)), ...active.threads].map(c => this.describeChannel(c, guildId)),
      coverage: "Text and announcement channels, forum/media parents, and accessible active threads. Use list_discord_archived_threads for archived threads. Reading a parent channel does not read its threads." };
  }

  async archivedThreads(channelId: string, kind: "public" | "joined_private", before?: string, limit = 50) {
    const parent = await this.channel(channelId);
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set("before", before);
    const suffix = kind === "public" ? "threads/archived/public" : "users/@me/threads/archived/private";
    const page = z.object({ threads: z.array(channelSchema.extend({ thread_metadata: z.object({ archived: z.boolean(), archive_timestamp: z.string() }) })), has_more: z.boolean() }).parse(await this.get(`/channels/${channelId}/${suffix}?${params}`));
    const last = page.threads.at(-1);
    return { threads: page.threads.map(c => this.describeChannel(c, parent.guild_id!)), has_more: page.has_more,
      next_before: page.has_more && last ? kind === "public" ? last.thread_metadata.archive_timestamp : last.id : null };
  }

  private message(raw: unknown, guildId: string) {
    const m = messageSchema.parse(raw);
    return { ...m, guild_id: guildId, server_name: this.guild(guildId).name,
      url: `https://discord.com/channels/${guildId}/${m.channel_id}/${m.id}` };
  }

  async history(input: z.infer<typeof historyInput>) {
    const options = historyInput.parse(input);
    const channel = await this.channel(options.channel_id);
    const params = new URLSearchParams({ limit: String(options.limit) });
    for (const key of ["before", "after", "around"] as const) if (options[key]) params.set(key, options[key]);
    if (options.since) snowflakeFromTime(options.since);
    const page = z.array(z.unknown()).parse(await this.get(`/channels/${channel.id}/messages?${params}`)).map(m => this.message(m, channel.guild_id!)).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
    if (!page.length && channel.last_message_id && !options.before && !options.after && !options.around) {
      throw new DiscordReadError("Discord returned no history despite a last-message marker. Check Baz's Read Message History permission; report this as a coverage gap.");
    }
    const messages = options.since ? page.filter(m => Date.parse(m.timestamp) >= Date.parse(options.since!)) : page;
    const windowComplete = !!options.since && (page.length < options.limit || Date.parse(page[0]?.timestamp ?? "") <= Date.parse(options.since));
    return { channel: this.describeChannel(channel, channel.guild_id!), messages,
      oldest_id: messages[0]?.id ?? null, newest_id: messages.at(-1)?.id ?? null,
      page_full: page.length === options.limit, next_before: windowComplete ? null : page[0]?.id ?? null, next_after: page.at(-1)?.id ?? null,
      window_complete: options.since ? windowComplete : null,
      coverage: "One page only. For time windows retain since and follow next_before until window_complete. Otherwise paginate before for older history or after for newer history. Empty content can mean a system message or unavailable message content." };
  }

  async messageById(channelId: string, messageId: string) {
    discordId.parse(messageId);
    const channel = await this.channel(channelId);
    return this.message(await this.get(`/channels/${channelId}/messages/${messageId}`), channel.guild_id!);
  }

  async search(input: z.infer<typeof searchInput>) {
    const options = searchInput.parse(input);
    this.guild(options.guild_id);
    if (options.channel_id) await this.channel(options.channel_id, options.guild_id);
    const params = new URLSearchParams({ content: options.query, offset: String(options.offset), limit: String(options.limit), sort_by: "timestamp", sort_order: "desc" });
    if (options.channel_id) params.set("channel_id", options.channel_id);
    if (options.author_id) params.set("author_id", options.author_id);
    if (options.since) params.set("min_id", snowflakeFromTime(options.since));
    if (options.before) params.set("max_id", snowflakeFromTime(options.before));
    const result = z.object({ messages: z.array(z.array(z.unknown())), total_results: z.number() }).parse(await this.get(`/guilds/${options.guild_id}/messages/search?${params}`));
    return { results: result.messages.map(group => group.map(m => this.message(m, options.guild_id))), total_results: result.total_results,
      next_offset: options.offset + options.limit < Math.min(result.total_results, 10000) ? options.offset + options.limit : null,
      coverage: "Discord's indexed search may lag and counts may change. A keyword search does not establish that all messages were reviewed." };
  }
}
