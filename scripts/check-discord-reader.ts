import { discordReaderFromEnv, DiscordReadError } from "../src/lib/discord-reader";

// Opt-in read-only smoke test. Credentials come from the caller's environment.
// Print coverage metadata only, never message text or credentials.
async function main() {
  const reader = discordReaderFromEnv();
  for (const server of reader.servers().servers) {
    const listing = await reader.channels(server.id);
    const channel = listing.channels.find(c => c.name === "general" && [0, 5].includes(c.type)) ?? listing.channels.find(c => [0, 5].includes(c.type));
    if (!channel) throw new Error("No text channel found for a configured server");
    const history = await reader.history({ channel_id: channel.id, limit: 5 });
    console.log(JSON.stringify({ server: server.name, listed_channels_and_threads: listing.channels.length, sampled_channel: channel.name, messages: history.messages.length, source_links: history.messages.every(m => m.url.startsWith("https://discord.com/channels/")) }));
  }
  const first = reader.servers().servers[0];
  const search = await reader.search({ guild_id: first.id, query: "the", limit: 1, offset: 0 });
  console.log(JSON.stringify({ search: "passed", returned_groups: search.results.length }));
}
main().catch(error => { console.error(error instanceof DiscordReadError ? error.message : "Discord smoke test failed response validation"); process.exitCode = 1; });
